import type { ContentBlock } from "@/types/engine"
import { isObject } from "../../lib/is-object.ts"

/**
 * Injected transcript records Claude Code excludes from human turns (its
 * `isHumanTurn`). Skipping them keeps a session opened with a slash command
 * from auto-titling off the caveat/breadcrumb written BEFORE the real prompt.
 * Conservative: tool-result user rows are NOT filtered.
 */

/**
 * OUTER record is an injected meta row. The flags live on the record, not
 * `record.message`: `isMeta` (local-command caveat, most envelopes),
 * `isCompactSummary` (post-compaction summary). An `api-request-blob` row is a
 * snapshot of what was sent to the API (context reminders plus the prompt
 * again), not a turn of the conversation.
 */
export function isSyntheticClaudeRecord(record: Record<string, unknown>): boolean {
  return record.isMeta === true || record.isCompactSummary === true || record.type === "api-request-blob"
}

/**
 * Claude Code's prompt-suggestion side request is written into the main chain
 * unflagged (`isSidechain: false`) and only rewound later. Its prompt opens
 * with this text; its reply chains off it by `parentUuid`.
 */
const SUGGESTION_PROMPT_PREFIX = "[SUGGESTION MODE:"

/**
 * Feed records in file order with the side-branch uuids seen so far; returns
 * the set with this record added when it is a side request or descends from
 * one, else the SAME set.
 */
export function trackClaudeSideRequest(
  record: Record<string, unknown>,
  side: ReadonlySet<string>,
): ReadonlySet<string> {
  const uuid = record.uuid
  if (typeof uuid !== "string") return side
  const parent = record.parentUuid
  if ((typeof parent === "string" && side.has(parent)) || isSuggestionPrompt(record)) return new Set(side).add(uuid)
  return side
}

function isSuggestionPrompt(record: Record<string, unknown>): boolean {
  if (record.type !== "user" || !isObject(record.message)) return false
  const c = record.message.content
  const first = typeof c === "string" ? c : Array.isArray(c) && isObject(c[0]) ? c[0].text : undefined
  return typeof first === "string" && first.startsWith(SUGGESTION_PROMPT_PREFIX)
}

/**
 * A `user` record that is ONLY a slash/bash-command breadcrumb (un-flagged
 * `<command-name>…` envelope). Any real prose mixed in keeps the row.
 */
export function isClaudeCommandBreadcrumb(blocks: readonly ContentBlock[]): boolean {
  if (blocks.length === 0) return false
  for (const b of blocks) {
    if (b.type !== "text") return false
    const t = b.text.trim()
    if (!t.startsWith("<command-name>") && !t.startsWith("<command-message>") && !t.startsWith("<local-command")) {
      return false
    }
  }
  return true
}

/** A text block that is wholly a `<system-reminder>` Claude Code wrote into a user turn. */
export function isClaudeSystemReminder(block: ContentBlock): boolean {
  if (block.type !== "text") return false
  const t = block.text.trim()
  return t.startsWith("<system-reminder>") && t.endsWith("</system-reminder>")
}
