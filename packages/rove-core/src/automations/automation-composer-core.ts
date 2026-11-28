/**
 * The automation composer card's fields and validation, with no terminal or i18n import (the web
 * client reuses it). Supports both time-driven (schedule/cron) and event-driven routines.
 * The schedule preview that goes with it is `cron-core.ts`.
 */

import {
  AUTOMATION_EVENT_KINDS,
  type Automation,
  type AutomationEventFilter,
  type AutomationEventKind,
  type AutomationEventTrigger,
} from "@sma1lboy/rove-daemon/daemon/contracts"
import { isValidCron } from "./cron-core"

export { AUTOMATION_EVENT_KINDS, type AutomationEventKind, type AutomationEventTrigger }

export type ComposerTriggerMode = "schedule" | "event"

/** Card fields, in tab order. `confirm` is the Create button. */
export type ComposerField =
  | "name"
  | "repo"
  | "target"
  | "targetTab"
  | "prompt"
  | "triggerMode"
  | "schedule"
  | "eventKind"
  | "eventFilter"
  | "confirm"

export const COMPOSER_FIELDS: readonly ComposerField[] = [
  "name",
  "repo",
  "target",
  "targetTab",
  "prompt",
  "triggerMode",
  "schedule",
  "eventKind",
  "eventFilter",
  "confirm",
]

/**
 * Tab / shift-tab, wrapping — the card is a loop, not a wizard with an end.
 * Target fields are skipped without a project; `targetTab` unless bound;
 * `schedule` is shown in schedule mode, `eventKind` + `eventFilter` in event mode.
 */
export function nextComposerField(
  field: ComposerField,
  delta: 1 | -1 = 1,
  bound = false,
  projectless = false,
  triggerMode: ComposerTriggerMode = "schedule",
): ComposerField {
  const fields = COMPOSER_FIELDS.filter(
    (f) =>
      !(f === "targetTab" && !bound) &&
      !(projectless && (f === "target" || f === "targetTab")) &&
      !(triggerMode === "schedule" && (f === "eventKind" || f === "eventFilter")) &&
      !(triggerMode === "event" && f === "schedule"),
  )
  const index = fields.indexOf(field)
  if (index < 0) return "name"
  const next = (index + delta + fields.length) % fields.length
  return fields[next] ?? "name"
}

export interface ComposerDraft {
  readonly name: string
  /** `null` = Ungrouped: the routine runs in its own scratch directory. `""` = not chosen yet. */
  readonly repo: string | null
  readonly prompt: string
  /** Absent defaults to `"schedule"` for backwards compatibility. */
  readonly triggerMode?: ComposerTriggerMode
  readonly schedule: string
  readonly eventKind?: AutomationEventKind
  /** Optional freeform filter: branch for PR events, `event.action` for webhook, event name for local. */
  readonly eventFilter?: string
  readonly target?: Automation["target"]
}

export const EMPTY_DRAFT: ComposerDraft = {
  name: "",
  repo: "",
  prompt: "",
  triggerMode: "schedule",
  schedule: "0 9 * * MON-FRI",
  eventKind: "ci_failed",
  eventFilter: "",
}

export function draftTriggerMode(draft: Pick<ComposerDraft, "triggerMode">): ComposerTriggerMode {
  return draft.triggerMode === "event" ? "event" : "schedule"
}

/** Convert composer `eventKind` + single-line `eventFilter` into a typed {@link AutomationEventTrigger}. */
export function buildEventTriggerFromDraft(kind: AutomationEventKind, rawFilter = ""): AutomationEventTrigger {
  const trimmed = rawFilter.trim()
  if (!trimmed) return { kind }
  let filter: AutomationEventFilter
  if (kind === "ci_failed" || kind === "pr_review_requested") {
    filter = { branch: trimmed }
  } else if (kind === "issue_opened") {
    filter = { action: trimmed }
  } else if (kind === "webhook") {
    const dot = trimmed.indexOf(".")
    filter =
      dot > 0 && dot < trimmed.length - 1
        ? { event: trimmed.slice(0, dot), action: trimmed.slice(dot + 1) }
        : { event: trimmed }
  } else {
    filter = { event: trimmed }
  }
  return { kind, filter }
}

/** Ready to submit? Every required field carries something and the active trigger is valid. */
export function canSubmitDraft(draft: ComposerDraft): boolean {
  const mode = draftTriggerMode(draft)
  const triggerValid =
    mode === "event"
      ? Boolean(draft.eventKind && (AUTOMATION_EVENT_KINDS as readonly string[]).includes(draft.eventKind))
      : isValidCron(draft.schedule.trim())
  return (
    draft.name.trim().length > 0 &&
    (draft.repo === null || draft.repo.trim().length > 0) &&
    draft.prompt.trim().length > 0 &&
    (!draft.target || (draft.target.taskId.trim().length > 0 && /^tab-[\w-]+$/.test(draft.target.tabId))) &&
    triggerValid
  )
}

/**
 * First incomplete field on a refused submit. Never `confirm` (a button can't
 * be blank), so the return type rules out a message that can't exist.
 */
export function firstIncompleteField(draft: ComposerDraft): Exclude<ComposerField, "confirm"> | null {
  if (draft.name.trim().length === 0) return "name"
  if (draft.repo !== null && draft.repo.trim().length === 0) return "repo"
  if (draft.target && !draft.target.taskId.trim()) return "target"
  if (draft.target && !/^tab-[\w-]+$/.test(draft.target.tabId)) return "targetTab"
  if (draft.prompt.trim().length === 0) return "prompt"
  if (draftTriggerMode(draft) === "event") {
    if (!draft.eventKind || !(AUTOMATION_EVENT_KINDS as readonly string[]).includes(draft.eventKind)) {
      return "eventKind"
    }
    return null
  }
  if (!isValidCron(draft.schedule.trim())) return "schedule"
  return null
}
