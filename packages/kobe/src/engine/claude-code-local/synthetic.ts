import type { ContentBlock } from "@/types/engine"

/**
 * Injected transcript records Claude Code excludes from human turns (its
 * `isHumanTurn`). Skipping them keeps a session opened with a slash command
 * from auto-titling off the caveat/breadcrumb written BEFORE the real prompt.
 * Conservative: tool-result user rows are NOT filtered.
 */

/**
 * OUTER record is an injected meta row. The flags live on the record, not
 * `record.message`: `isMeta` (local-command caveat, most envelopes),
 * `isCompactSummary` (post-compaction summary).
 */
export function isSyntheticClaudeRecord(record: Record<string, unknown>): boolean {
  return record.isMeta === true || record.isCompactSummary === true
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
