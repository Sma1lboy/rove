/**
 * Five-field cron parsing + occurrence search for daemon Automations.
 *
 * Hand-rolled: zero scheduling deps, and `bun build --compile` bans N-API
 * addons. Pure, local-time; no timezone field (out of scope for v1).
 * {@link nextCronAfter} advances after a fire; {@link latestCronAtOrBefore}
 * answers "what SHOULD have run" for missed-run compensation.
 *
 * Both scan the LOCAL CALENDAR (day by day, then only named hours/minutes),
 * never epoch minutes. That is the DST fix: a fall-back minute maps to two
 * instants, a spring-forward one to none; epoch stepping fired daily routines
 * twice each autumn and skipped them each spring. One firing per local minute;
 * a nonexistent time resolves to where the clock jumped (02:30 → 03:30).
 *
 * Day steps also keep huge gaps cheap: `0 0 29 2 *` skips 8 years over 2100;
 * minute steps were 4.7M Date allocations (~150ms), and the TUI's schedule
 * preview runs this in the render body — once per keypress.
 */

const MINUTE_MS = 60_000

/** Scan ceiling in days. Sized for `0 0 29 2 *` (Feb 29 across 2100). */
const SCAN_DAYS = 9 * 366

export interface ParsedCron {
  readonly minutes: ReadonlySet<number>
  readonly hours: ReadonlySet<number>
  readonly daysOfMonth: ReadonlySet<number>
  readonly months: ReadonlySet<number>
  readonly daysOfWeek: ReadonlySet<number>
  /** True when the day-of-month field is anything but `*`. */
  readonly dayOfMonthRestricted: boolean
  /** True when the day-of-week field is anything but `*`. */
  readonly dayOfWeekRestricted: boolean
}

const MONTH_NAMES: ReadonlyMap<string, number> = new Map([
  ["JAN", 1],
  ["FEB", 2],
  ["MAR", 3],
  ["APR", 4],
  ["MAY", 5],
  ["JUN", 6],
  ["JUL", 7],
  ["AUG", 8],
  ["SEP", 9],
  ["OCT", 10],
  ["NOV", 11],
  ["DEC", 12],
])

const DAY_NAMES: ReadonlyMap<string, number> = new Map([
  ["SUN", 0],
  ["MON", 1],
  ["TUE", 2],
  ["WED", 3],
  ["THU", 4],
  ["FRI", 5],
  ["SAT", 6],
])

/** Bound the accepted expression so a pathological string can't drive the parser. */
const MAX_EXPRESSION_LENGTH = 256

function fieldNumber(raw: string, names: ReadonlyMap<string, number> | undefined, field: string): number {
  const token = raw.toUpperCase()
  const named = names?.get(token)
  if (named !== undefined) return named
  // Number("") is 0 and Number(" 5 ") is 5; require literal digits.
  if (!/^\d+$/.test(token)) throw new Error(`invalid cron ${field}: ${raw}`)
  return Number(token)
}

/** One comma-separated field: `*`, `N`, `A-B`, each with optional `/step` (`10-30/5`). */
function parseField(args: {
  value: string
  min: number
  max: number
  field: string
  names?: ReadonlyMap<string, number>
  /** Day-of-week only: cron accepts 7 as Sunday alongside 0. */
  normalize?: (value: number) => number
}): Set<number> {
  const out = new Set<number>()
  for (const part of args.value.split(",")) {
    if (part.length === 0) throw new Error(`invalid cron ${args.field}: ${args.value}`)
    const [spec, stepRaw, ...extra] = part.split("/")
    if (extra.length > 0 || spec === undefined) throw new Error(`invalid cron ${args.field}: ${part}`)
    let step = 1
    if (stepRaw !== undefined) {
      if (!/^\d+$/.test(stepRaw)) throw new Error(`invalid cron ${args.field} step: ${part}`)
      step = Number(stepRaw)
      if (step < 1) throw new Error(`invalid cron ${args.field} step: ${part}`)
    }

    let lo: number
    let hi: number
    if (spec === "*") {
      lo = args.min
      hi = args.max
    } else if (spec.includes("-")) {
      const [loRaw, hiRaw, ...rest] = spec.split("-")
      if (rest.length > 0 || loRaw === undefined || hiRaw === undefined) {
        throw new Error(`invalid cron ${args.field} range: ${part}`)
      }
      lo = fieldNumber(loRaw, args.names, args.field)
      hi = fieldNumber(hiRaw, args.names, args.field)
    } else {
      lo = fieldNumber(spec, args.names, args.field)
      // A bare `N/step` means "from N to the field max", not just N.
      hi = stepRaw === undefined ? lo : args.max
    }

    if (lo < args.min || hi > args.max || lo > hi) {
      throw new Error(`cron ${args.field} out of range: ${part}`)
    }
    for (let v = lo; v <= hi; v += step) out.add(args.normalize ? args.normalize(v) : v)
  }
  return out
}

/** Parse a five-field expression. Throws with a human-readable reason. */
export function parseCron(expression: string): ParsedCron {
  if (expression.length > MAX_EXPRESSION_LENGTH) throw new Error("cron expression is too long")
  const fields = expression.trim().split(/\s+/).filter(Boolean)
  if (fields.length !== 5) {
    throw new Error(`cron expression needs 5 fields (minute hour day month weekday), got ${fields.length}`)
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields as [string, string, string, string, string]
  return {
    minutes: parseField({ value: minute, min: 0, max: 59, field: "minute" }),
    hours: parseField({ value: hour, min: 0, max: 23, field: "hour" }),
    daysOfMonth: parseField({ value: dayOfMonth, min: 1, max: 31, field: "day-of-month" }),
    months: parseField({ value: month, min: 1, max: 12, field: "month", names: MONTH_NAMES }),
    daysOfWeek: parseField({
      value: dayOfWeek,
      min: 0,
      max: 7,
      field: "weekday",
      names: DAY_NAMES,
      // 7 and 0 are both Sunday; fold so matching only ever tests 0-6.
      normalize: (v) => v % 7,
    }),
    dayOfMonthRestricted: dayOfMonth !== "*",
    dayOfWeekRestricted: dayOfWeek !== "*",
  }
}

/** True when `expression` parses. Used by CLI/RPC validation before persisting. */
export function isValidCron(expression: string): boolean {
  try {
    parseCron(expression)
    return true
  } catch {
    return false
  }
}

/** A local wall-clock day. The scans step in these, never in epoch minutes. */
interface LocalDay {
  year: number
  /** 1-12, matching the cron field rather than `Date`'s 0-11. */
  month: number
  day: number
}

/** A repeated local time resolves to one of its instants; a skipped one to where the clock jumped. */
function instantOf(d: LocalDay, hour: number, minute: number): number {
  return new Date(d.year, d.month - 1, d.day, hour, minute, 0, 0).getTime()
}

function localDayOf(ms: number): LocalDay {
  const d = new Date(ms)
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }
}

/** Shift by whole local days through `Date`, which owns month/year rollover. */
function shiftDay(d: LocalDay, delta: number): LocalDay {
  return localDayOf(new Date(d.year, d.month - 1, d.day + delta, 12, 0, 0, 0).getTime())
}

/** Vixie rule: when BOTH day fields are restricted they are OR'd (`0 0 1 * MON` = the 1st **or** any Monday). */
function dayMatches(rule: ParsedCron, d: LocalDay): boolean {
  if (!rule.months.has(d.month)) return false
  const domMatch = rule.daysOfMonth.has(d.day)
  const dowMatch = rule.daysOfWeek.has(new Date(d.year, d.month - 1, d.day).getDay())
  if (rule.dayOfMonthRestricted && rule.dayOfWeekRestricted) return domMatch || dowMatch
  if (rule.dayOfMonthRestricted) return domMatch
  if (rule.dayOfWeekRestricted) return dowMatch
  return true
}

/** "Is this instant an occurrence". The scans don't use it — they enumerate local minutes to stay DST-correct. */
export function cronMatches(rule: ParsedCron, timeMs: number): boolean {
  const d = new Date(timeMs)
  if (!rule.minutes.has(d.getMinutes())) return false
  if (!rule.hours.has(d.getHours())) return false
  return dayMatches(rule, localDayOf(timeMs))
}

/** Every supported offset is whole minutes, so this is a local minute boundary too. */
function floorToMinute(ms: number): number {
  return ms - (ms % MINUTE_MS)
}

function sorted(values: ReadonlySet<number>, direction: 1 | -1): number[] {
  return [...values].sort((a, b) => (a - b) * direction)
}

/**
 * First occurrence strictly AFTER `afterMs` — `<=` would return the run that
 * just fired and spin the runner. Throws when none is within the scan bound
 * (`0 0 30 2 *`), so it surfaces at create time instead of a silent no-op.
 */
export function nextCronAfter(expression: string, afterMs: number): number {
  const rule = parseCron(expression)
  const hours = sorted(rule.hours, 1)
  const minutes = sorted(rule.minutes, 1)
  const from = new Date(floorToMinute(afterMs) + MINUTE_MS)
  let day = localDayOf(from.getTime())
  let fromHour = from.getHours()
  let fromMinute = from.getMinutes()
  for (let i = 0; i < SCAN_DAYS; i++) {
    if (dayMatches(rule, day)) {
      for (const hour of hours) {
        if (hour < fromHour) continue
        for (const minute of minutes) {
          if (hour === fromHour && minute < fromMinute) continue
          const at = instantOf(day, hour, minute)
          // A repeated-hour minute can resolve at or before `afterMs`; skip it.
          if (at > afterMs) return at
        }
      }
    }
    day = shiftDay(day, 1)
    fromHour = 0
    fromMinute = 0
  }
  throw new Error(`cron expression never matches: ${expression}`)
}

/**
 * Latest occurrence in `[notBeforeMs, nowMs]`, else `null`. Callers pass the
 * schedule's creation time as `notBeforeMs`, so a new automation can't claim
 * occurrences that predate it.
 */
export function latestCronAtOrBefore(expression: string, nowMs: number, notBeforeMs: number): number | null {
  if (nowMs < notBeforeMs) return null
  const rule = parseCron(expression)
  const hours = sorted(rule.hours, -1)
  const minutes = sorted(rule.minutes, -1)
  const from = new Date(floorToMinute(nowMs))
  let day = localDayOf(from.getTime())
  let fromHour = from.getHours()
  let fromMinute = from.getMinutes()
  for (let i = 0; i < SCAN_DAYS; i++) {
    // All remaining candidates are earlier than this day's last minute.
    if (instantOf(day, 23, 59) < notBeforeMs) return null
    if (dayMatches(rule, day)) {
      for (const hour of hours) {
        if (hour > fromHour) continue
        for (const minute of minutes) {
          if (hour === fromHour && minute > fromMinute) continue
          const at = instantOf(day, hour, minute)
          if (at > nowMs) continue
          return at >= notBeforeMs ? at : null
        }
      }
    }
    day = shiftDay(day, -1)
    fromHour = 23
    fromMinute = 59
  }
  return null
}

/**
 * Occurrences in `[fromMs, beforeMs)`, capped at `cap`. {@link latestCronAtOrBefore}
 * runs only the newest, so a late sweep's skipped ones leave no trace; this
 * lets run history record them as lost. Capped: per-minute × a week down is
 * 10,000 instants.
 */
export function countCronBetween(expression: string, fromMs: number, beforeMs: number, cap = 500): number {
  if (!(fromMs < beforeMs)) return 0
  let count = 0
  // `nextCronAfter` is strictly-after; 1ms early makes `fromMs` a candidate.
  let cursor = fromMs - 1
  while (count < cap) {
    let at: number
    try {
      at = nextCronAfter(expression, cursor)
    } catch {
      // Past the scan bound; a count isn't worth failing a sweep over.
      return count
    }
    if (at >= beforeMs) return count
    count += 1
    cursor = at
  }
  return count
}
