/**
 * Framework-free state for the automation composer card (field order,
 * validation, schedule preview). A cron expression can't be checked by
 * reading it back, so the composer continuously answers "weekdays at 09:00 —
 * next Mon Aug 3, 09:00" instead of letting the daemon reject a typo later.
 */

import { intlLocale, t } from "@/tui/i18n"
import type { Automation } from "@sma1lboy/kobe-daemon/daemon/contracts"
import { isValidCron, nextCronAfter } from "@sma1lboy/kobe-daemon/daemon/cron"
import { relativeBuckets } from "../../lib/relative-time"

/** Card fields, in tab order. `confirm` is the Create button. */
export type ComposerField = "name" | "repo" | "target" | "targetTab" | "prompt" | "schedule" | "confirm"

export const COMPOSER_FIELDS: readonly ComposerField[] = [
  "name",
  "repo",
  "target",
  "targetTab",
  "prompt",
  "schedule",
  "confirm",
]

/** Tab / shift-tab, wrapping — the card is a loop, not a wizard with an end. */
export function nextComposerField(field: ComposerField, delta: 1 | -1 = 1, bound = false): ComposerField {
  const fields = bound ? COMPOSER_FIELDS : COMPOSER_FIELDS.filter((f) => f !== "targetTab")
  const index = fields.indexOf(field)
  if (index < 0) return "name"
  const next = (index + delta + fields.length) % fields.length
  return fields[next] ?? "name"
}

export interface ComposerDraft {
  readonly name: string
  readonly repo: string
  readonly prompt: string
  readonly schedule: string
  readonly target?: Automation["target"]
}

export const EMPTY_DRAFT: ComposerDraft = { name: "", repo: "", prompt: "", schedule: "0 9 * * MON-FRI" }

/** Ready to submit? Every field carries something and the cron parses. */
export function canSubmitDraft(draft: ComposerDraft): boolean {
  return (
    draft.name.trim().length > 0 &&
    draft.repo.trim().length > 0 &&
    draft.prompt.trim().length > 0 &&
    (!draft.target || (draft.target.taskId.trim().length > 0 && /^tab-[\w-]+$/.test(draft.target.tabId))) &&
    isValidCron(draft.schedule.trim())
  )
}

/**
 * First incomplete field on a refused submit. Never `confirm` (a button can't
 * be blank), so the return type rules out a message that can't exist.
 */
export function firstIncompleteField(draft: ComposerDraft): Exclude<ComposerField, "confirm"> | null {
  if (draft.name.trim().length === 0) return "name"
  if (draft.repo.trim().length === 0) return "repo"
  if (draft.target && !draft.target.taskId.trim()) return "target"
  if (draft.target && !/^tab-[\w-]+$/.test(draft.target.tabId)) return "targetTab"
  if (draft.prompt.trim().length === 0) return "prompt"
  if (!isValidCron(draft.schedule.trim())) return "schedule"
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
 */
export function previewSchedule(expression: string, nowMs: number): SchedulePreview {
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
    relative: formatRelative(nextRunMs - nowMs),
    absolute: formatAbsolute(nextRunMs, nowMs),
  }
}

function formatRelative(deltaMs: number): string {
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
function formatAbsolute(atMs: number, nowMs: number): string {
  const at = new Date(atMs)
  const time = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`
  const now = new Date(nowMs)
  const sameDay =
    at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate()
  if (sameDay) return time
  const withinWeek = atMs - nowMs < 6 * 24 * 60 * 60 * 1000
  const date = at.toLocaleDateString(
    intlLocale(),
    withinWeek ? { weekday: "short" } : { weekday: "short", month: "short", day: "numeric" },
  )
  return withinWeek ? `${date} ${time}` : t("automations.when.dateTime", { date, time })
}
