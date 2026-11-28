/**
 * The automation composer card's fields and validation, with no terminal or i18n import (the web
 * client reuses it). The schedule preview that goes with it is `cron-core.ts`.
 */

import type { Automation } from "@sma1lboy/rove-daemon/daemon/contracts"
import { isValidCron } from "./cron-core"

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

/**
 * Tab / shift-tab, wrapping — the card is a loop, not a wizard with an end. The target fields
 * are skipped without a project (nothing to deliver to) and `targetTab` unless a target is bound.
 */
export function nextComposerField(
  field: ComposerField,
  delta: 1 | -1 = 1,
  bound = false,
  projectless = false,
): ComposerField {
  const fields = COMPOSER_FIELDS.filter(
    (f) => !(f === "targetTab" && !bound) && !(projectless && (f === "target" || f === "targetTab")),
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
  readonly schedule: string
  readonly target?: Automation["target"]
}

export const EMPTY_DRAFT: ComposerDraft = { name: "", repo: "", prompt: "", schedule: "0 9 * * MON-FRI" }

/** Ready to submit? Every field carries something and the cron parses. */
export function canSubmitDraft(draft: ComposerDraft): boolean {
  return (
    draft.name.trim().length > 0 &&
    (draft.repo === null || draft.repo.trim().length > 0) &&
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
  if (draft.repo !== null && draft.repo.trim().length === 0) return "repo"
  if (draft.target && !draft.target.taskId.trim()) return "target"
  if (draft.target && !/^tab-[\w-]+$/.test(draft.target.tabId)) return "targetTab"
  if (draft.prompt.trim().length === 0) return "prompt"
  if (!isValidCron(draft.schedule.trim())) return "schedule"
  return null
}
