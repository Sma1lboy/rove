/**
 * Five-field cron parsing + occurrence search for daemon Automations.
 *
 * Hand-rolled on purpose: the repo has ZERO scheduling dependencies, and
 * `bun build --compile` bans native/N-API addons — a pure-JS parser sized to
 * five fields is smaller than auditing a package for that constraint.
 *
 * Two functions, both pure, both local-time (the daemon runs on the user's
 * machine; a timezone field is deliberately out of scope for v1):
 *
 *   - {@link nextCronAfter}       — advance a schedule after it fires
 *   - {@link latestCronAtOrBefore} — "what SHOULD have run by now", which is
 *     what missed-run compensation needs after the daemon was down
 *
 * Both scan the LOCAL CALENDAR — day by day, then only the hours and minutes
 * the expression actually names — rather than stepping fixed epoch minutes.
 * That is what makes them DST-correct: a cron expression names a wall clock,
 * and on a fall-back day one wall-clock minute maps to two epoch instants
 * while on a spring-forward day one maps to none. Stepping epoch minutes and
 * testing the local clock fired a daily routine twice every autumn and
 * skipped it silently every spring. Enumerating each local minute exactly
 * once, then converting to an instant, gives one firing per day in both
 * directions; a nonexistent local time resolves to the instant the clock
 * jumped to (02:30 fires at 03:30) rather than vanishing.
 *
 * Day-at-a-time also keeps the pathological case cheap. A valid expression can
 * have a genuinely huge gap (`0 0 29 2 *` skips 8 years across a non-leap
 * century boundary); at a minute per step that is 4.7M iterations, each
 * allocating a Date — ~150ms on the daemon's event loop, and the TUI's
 * schedule preview runs it in the render body, so arrowing the day-of-month
 * past 29 with the month on `2` froze the terminal once per keypress.
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
  // Number("") is 0 and Number(" 5 ") is 5 — neither is a valid cron token, so
  // require the literal digit form before trusting the coercion.
  if (!/^\d+$/.test(token)) throw new Error(`invalid cron ${field}: ${raw}`)
  return Number(token)
}

/**
 * One comma-separated field into the set of values it matches. Supports
 * a star, `N`, `A-B`, and a `/step` suffix on any of those (`10-30/5`).
 */
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

/** The instant a local wall clock names. An ambiguous (repeated) local time
 *  resolves to one of its two instants and a nonexistent (skipped) one to the
 *  instant the clock jumped to — both deliberate, see the module header. */
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

/**
 * Does this local day match? The Vixie-cron rule that trips everyone up: when
 * BOTH day fields are restricted they are OR'd, not AND'd (`0 0 1 * MON` = the
 * 1st **or** any Monday). With one restricted, only that one applies; with
 * neither, every day matches.
 */
function dayMatches(rule: ParsedCron, d: LocalDay): boolean {
  if (!rule.months.has(d.month)) return false
  const domMatch = rule.daysOfMonth.has(d.day)
  const dowMatch = rule.daysOfWeek.has(new Date(d.year, d.month - 1, d.day).getDay())
  if (rule.dayOfMonthRestricted && rule.dayOfWeekRestricted) return domMatch || dowMatch
  if (rule.dayOfMonthRestricted) return domMatch
  if (rule.dayOfWeekRestricted) return dowMatch
  return true
}

/**
 * Does `timeMs` match? Same day rule as {@link dayMatches}, applied to the
 * whole instant. The scans do not use this — they enumerate matching local
 * minutes instead, which is what keeps them one-firing-per-day across a DST
 * boundary — but it is the honest "is this instant an occurrence" predicate.
 */
export function cronMatches(rule: ParsedCron, timeMs: number): boolean {
  const d = new Date(timeMs)
  if (!rule.minutes.has(d.getMinutes())) return false
  if (!rule.hours.has(d.getHours())) return false
  return dayMatches(rule, localDayOf(timeMs))
}

/** Truncate to the start of the containing minute (cron's resolution).
 *  Epoch ms are UTC-anchored and every supported timezone offset is a whole
 *  number of minutes, so the modulo lands on a local minute boundary too. */
function floorToMinute(ms: number): number {
  return ms - (ms % MINUTE_MS)
}

function sorted(values: ReadonlySet<number>, direction: 1 | -1): number[] {
  return [...values].sort((a, b) => (a - b) * direction)
}

/**
 * First occurrence strictly AFTER `afterMs`.
 *
 * Strictly-after matters: this is called right after a run fires, and a
 * `<=` boundary would return the timestamp that just fired and spin the
 * runner. Throws when no occurrence exists within the scan bound — a
 * schedule that parses but never fires (`0 0 30 2 *`) is a user error worth
 * surfacing at create time, not a silent no-op.
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
          // A local minute inside a repeated hour can resolve to an instant at
          // or before `afterMs` (the earlier of its two offsets). Skipping it
          // keeps the result strictly increasing without firing twice.
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
 * Latest occurrence at or before `nowMs`, searching back no further than
 * `notBeforeMs`; `null` when none exists in that window.
 *
 * This is the missed-run question: after the daemon was down, "what should
 * have run?" is NOT the same as "when is the next run" — the answer has to
 * look backwards. `notBeforeMs` bounds the walk (callers pass the schedule's
 * creation time, so a brand-new automation can't claim occurrences that
 * predate it).
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
    // Every remaining candidate is earlier than this day's last minute, so once
    // that is out of the window there is nothing left to find.
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
