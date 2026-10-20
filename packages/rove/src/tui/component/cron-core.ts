/**
 * Framework- and i18n-free core of the routine composer, shared by the TUI card and the web
 * client: a cron expression as five editable segments (←/→ moves, ↑/↓ changes the one under the
 * cursor, along a LADDER of `*`, common `*\/n` divisors, then plain numbers, so each rung means
 * something), the plain-language description, and the live "when does this fire" preview.
 *
 * Copy comes through a `Translate` the caller supplies (the TUI's `t`, the web's catalog lookup),
 * so this file imports nothing that reaches the terminal.
 */

import { isValidCron, nextCronAfter } from "@sma1lboy/rove-daemon/daemon/cron"
import { relativeBuckets } from "../../lib/relative-time"

export { isValidCron }

export type Translate = (key: string, params?: Record<string, string | number>) => string

/** Which of the five cron fields a segment is. Index = position. */
export const CRON_SEGMENTS = ["minute", "hour", "dayOfMonth", "month", "dayOfWeek"] as const
export type CronSegment = (typeof CRON_SEGMENTS)[number]

/** Split an expression into exactly five parts, padding a short one with `*`. */
export function splitCron(expression: string): string[] {
  const parts = expression.trim().split(/\s+/).filter(Boolean)
  return CRON_SEGMENTS.map((_, index) => parts[index] ?? "*")
}

export function joinCron(parts: readonly string[]): string {
  return CRON_SEGMENTS.map((_, index) => parts[index] ?? "*").join(" ")
}

const MINUTE_LADDER = ["*", "*/5", "*/10", "*/15", "*/30", ...range(0, 59)]
const HOUR_LADDER = ["*", "*/2", "*/3", "*/4", "*/6", "*/12", ...range(0, 23)]
const DOM_LADDER = ["*", ...range(1, 31)]
const MONTH_LADDER = ["*", "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
// Weekday ranges lead: "weekdays"/"weekends" are how people describe
// schedules, and stepping single days can't reach them.
const DOW_LADDER = ["*", "MON-FRI", "SAT,SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]

/** Weekday codes `describeCron` names; each needs `automations.schedule.dow.*`
 *  in the catalog (plurals don't derive mechanically: "TUE" + "days"). */
export const DOW_CODES = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const

function range(from: number, to: number): string[] {
  const out: string[] = []
  for (let n = from; n <= to; n++) out.push(String(n))
  return out
}

const LADDERS: Record<CronSegment, readonly string[]> = {
  minute: MINUTE_LADDER,
  hour: HOUR_LADDER,
  dayOfMonth: DOM_LADDER,
  month: MONTH_LADDER,
  dayOfWeek: DOW_LADDER,
}

/** Every value ↑/↓ can reach for `segment`, in rung order. */
export function ladderFor(segment: CronSegment): readonly string[] {
  return LADDERS[segment]
}

/**
 * Wraps. A hand-typed off-ladder value (`17-23`, `1,15`) lands on the nearest
 * end rather than being rewritten: segments aid typing, they don't restrict it.
 */
export function stepSegment(segment: CronSegment, current: string, delta: 1 | -1): string {
  const ladder = LADDERS[segment]
  const index = ladder.indexOf(current.trim().toUpperCase())
  if (index < 0) return (delta > 0 ? ladder[0] : ladder[ladder.length - 1]) ?? current
  const next = (index + delta + ladder.length) % ladder.length
  return ladder[next] ?? current
}

/** Clamped: the row has ends, no wrap. */
export function moveSegmentCursor(cursor: number, delta: 1 | -1): number {
  return Math.min(Math.max(cursor + delta, 0), CRON_SEGMENTS.length - 1)
}

/** Replace one segment, returning the whole expression. */
export function setSegment(expression: string, index: number, value: string): string {
  const parts = splitCron(expression)
  if (index < 0 || index >= CRON_SEGMENTS.length) return joinCron(parts)
  parts[index] = value
  return joinCron(parts)
}

/**
 * Only for shapes worth naming; null otherwise, since a half-truth about when
 * a schedule fires is worse than the raw cron plus the next-run preview.
 */
export function describeCronWith(expression: string, t: Translate): string | null {
  const [minute, hour, dom, month, dow] = splitCron(expression)
  if (month !== "*" || dom !== "*") return null
  if (minute === undefined || hour === undefined || dow === undefined) return null

  const timeOfDay = describeTimeOfDay(minute, hour, t)
  if (!timeOfDay) return null
  const { at, bare } = timeOfDay
  // An "every N" phrase already recurs, so it takes no "every day" qualifier.
  if (dow === "*") return bare ? at : t("automations.schedule.everyDay", { at })
  if (dow === "MON-FRI") return t("automations.schedule.weekdays", { at })
  if (dow === "SAT,SUN") return t("automations.schedule.weekends", { at })
  const code = DOW_CODES.find((candidate) => candidate === dow.toUpperCase())
  if (code) return t("automations.schedule.onWeekday", { weekday: t(`automations.schedule.dow.${code}`), at })
  return null
}

/**
 * `bare` marks phrases that ALREADY recur ("every 15m"); reported rather than
 * sniffed from an English "every " prefix, which translations lack.
 */
function describeTimeOfDay(minute: string, hour: string, t: Translate): { at: string; bare: boolean } | null {
  if (hour === "*") {
    if (minute === "*") return { at: t("automations.schedule.everyMinute"), bare: true }
    if (minute.startsWith("*/"))
      return { at: t("automations.schedule.everyMinutes", { n: minute.slice(2) }), bare: true }
    // Only a single minute is a real fire time; `:15,45` would assert an
    // instant the schedule never has.
    if (/^\d+$/.test(minute))
      return { at: t("automations.schedule.hourlyAt", { minute: minute.padStart(2, "0") }), bare: false }
    return null
  }
  if (hour.startsWith("*/") && minute === "0")
    return { at: t("automations.schedule.everyHours", { n: hour.slice(2) }), bare: true }
  if (/^\d+$/.test(hour) && /^\d+$/.test(minute)) {
    const time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`
    return { at: t("automations.schedule.atClock", { time }), bare: false }
  }
  return null
}

export type SchedulePreview =
  | { readonly kind: "invalid" }
  /** Parses but never fires (`0 0 30 2 *`) — valid syntax, useless schedule. */
  | { readonly kind: "never" }
  | { readonly kind: "ok"; readonly nextRunMs: number; readonly relative: string; readonly absolute: string }

/**
 * Next fire time in the user's timezone, both relative ("in 14h": is it soon?)
 * and absolute (is it the time I meant?); a cron typo usually misreads in one.
 * `locale` is the `Intl` locale the calendar words come from.
 */
export function previewScheduleWith(expression: string, nowMs: number, t: Translate, locale: string): SchedulePreview {
  const trimmed = expression.trim()
  if (!isValidCron(trimmed)) return { kind: "invalid" }
  let nextRunMs: number
  try {
    nextRunMs = nextCronAfter(trimmed, nowMs)
  } catch {
    return { kind: "never" }
  }
  return {
    kind: "ok",
    nextRunMs,
    relative: formatRelative(nextRunMs - nowMs, t),
    absolute: formatAbsolute(nextRunMs, nowMs, t, locale),
  }
}

function formatRelative(deltaMs: number, t: Translate): string {
  const { minutes, hours, days } = relativeBuckets(deltaMs)
  if (minutes < 60) return t("automations.when.inMinutes", { n: Math.max(1, minutes) })
  if (hours < 24) return t("automations.when.inHours", { n: hours })
  return t("automations.when.inDays", { n: days })
}

/**
 * Coarsest useful precision: `09:00` today, `Mon 09:00` this week,
 * `Mon, Aug 3, 09:00` beyond. Calendar words and ORDER come from `Intl` for the
 * UI locale (zh reads `8月3日周一`, not `周一 8月 3`). The 24-hour clock is
 * built by hand: same in every locale, where `Intl`'s en-US gives `9:00 AM`.
 */
function formatAbsolute(atMs: number, nowMs: number, t: Translate, locale: string): string {
  const at = new Date(atMs)
  const time = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`
  const now = new Date(nowMs)
  const sameDay =
    at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate()
  if (sameDay) return time
  const withinWeek = atMs - nowMs < 6 * 24 * 60 * 60 * 1000
  const date = at.toLocaleDateString(
    locale,
    withinWeek ? { weekday: "short" } : { weekday: "short", month: "short", day: "numeric" },
  )
  return withinWeek ? `${date} ${time}` : t("automations.when.dateTime", { date, time })
}
