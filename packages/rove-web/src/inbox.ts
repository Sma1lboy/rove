/**
 * Inbox item → glyph, tone and state word, the TUI's vocabulary
 * (`tui-react/workspace/inbox-item-view.ts`) so a rate limit and a crash
 * read differently here too.
 */

import type { AttentionRow } from "rove-bridge/protocol"
import type { Tone } from "./rail-glyphs.ts"

export interface InboxBadge {
  readonly glyph: string
  readonly tone: Tone
  /** i18n key under `inbox.state.*`. */
  readonly stateKey: string
}

export function inboxBadge(state: string): InboxBadge {
  switch (state) {
    case "permission_needed":
      return { glyph: "?", tone: "warning", stateKey: "inbox.state.needsInput" }
    case "turn_complete":
      return { glyph: "✓", tone: "success", stateKey: "inbox.state.done" }
    case "rate_limited":
      return { glyph: "◷", tone: "warning", stateKey: "inbox.state.rateLimited" }
    case "dead":
      return { glyph: "†", tone: "attention", stateKey: "inbox.state.dead" }
    case "decision_needed":
      return { glyph: "?", tone: "warning", stateKey: "inbox.state.decision" }
    case "routine_failed":
      return { glyph: "↻", tone: "attention", stateKey: "inbox.state.routineFailed" }
    case "report_missing":
      return { glyph: "!", tone: "warning", stateKey: "inbox.state.reportMissing" }
    default:
      return { glyph: "!", tone: "attention", stateKey: "inbox.state.error" }
  }
}

/** `3m`, `2h`, `4d`: the TUI's compact age. */
export function compactAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.round(h / 24)}d`
}

/** TUI `isRoutineInboxState`: the episode's subject is a schedule, not a task. */
export const isRoutineState = (state: string): boolean => state === "routine_failed"

const keyOf = (row: Pick<AttentionRow, "taskId" | "tabId">) => `${row.taskId ?? ""}:${row.tabId ?? ""}`

/** TUI `sortAttentionInbox`: blocked episodes first, then oldest first, task order breaking ties. */
export function sortAttention(rows: readonly AttentionRow[], taskOrder: readonly string[]): AttentionRow[] {
  const at = new Map(taskOrder.map((id, i) => [id, i]))
  const band = (row: AttentionRow) => (row.state === "turn_complete" ? 1 : 0)
  const rank = (row: AttentionRow) => at.get(row.taskId ?? "") ?? Number.MAX_SAFE_INTEGER
  return [...rows].sort(
    (a, b) => band(a) - band(b) || a.at - b.at || rank(a) - rank(b) || keyOf(a).localeCompare(keyOf(b)),
  )
}

/**
 * F7's target, as TUI `nextAttentionInboxTarget`: the episode after the one being viewed, else the
 * first. A routine episode (no task) stays eligible; a task episode needs its task listed.
 */
export function nextAttention(
  rows: readonly AttentionRow[],
  taskOrder: readonly string[],
  current: { taskId: string | null; tabId: string | null },
): AttentionRow | null {
  const live = new Set(taskOrder)
  const ordered = sortAttention(rows, taskOrder).filter((row) => row.taskId === null || live.has(row.taskId))
  if (ordered.length === 0) return null
  const i = current.taskId === null ? -1 : ordered.findIndex((row) => keyOf(row) === keyOf(current))
  if (i < 0 || ordered.length === 1) return ordered[0] ?? null
  return ordered[(i + 1) % ordered.length] ?? null
}

export const PEEK_LINES = 12

/** The slice of an `output.read` reply a peek draws. */
export interface TerminalReply {
  readonly terminal?: { readonly tail?: readonly string[] }
}

/** The tab's last output lines, as the engine left them: row padding trimmed, blank rows around the text dropped. */
export function tailOf(reply: TerminalReply): string[] {
  const rows = (reply.terminal?.tail ?? []).map((line) => line.trimEnd())
  let end = rows.length
  while (end > 0 && rows[end - 1] === "") end--
  let start = 0
  while (start < end && rows[start] === "") start++
  return rows.slice(Math.max(start, end - PEEK_LINES), end)
}
