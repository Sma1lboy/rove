/** The task activity list's rows: what each event kind draws, where a click goes, and which PR changes a feed update shows. */

import type { TaskRowPr } from "rove-bridge/protocol"

/** A `task.timeline` entry, or a PR change this page saw. */
export interface TimelineRow {
  readonly kind: string
  readonly at: number
  readonly tail: string
  readonly tabId?: string
  readonly sha?: string
  readonly url?: string
}

export interface KindLook {
  readonly glyph: string
  readonly tone: string
}

/** Every kind the daemon's ring or this page produces; a kind from a newer daemon draws as `LOOK_OTHER` with its raw name. */
export const KIND_LOOK: Readonly<Record<string, KindLook>> = {
  "session-start": { glyph: "○", tone: "text-muted" },
  "turn-start": { glyph: "▶", tone: "text-info" },
  "turn-complete": { glyph: "✓", tone: "text-success" },
  "turn-failed": { glyph: "✗", tone: "text-error" },
  "turn-interrupted": { glyph: "■", tone: "text-warning" },
  "awaiting-input": { glyph: "?", tone: "text-warning" },
  "session-end": { glyph: "○", tone: "text-muted" },
  "tool-failed": { glyph: "!", tone: "text-error" },
  "pre-compact": { glyph: "≈", tone: "text-muted" },
  "post-compact": { glyph: "≈", tone: "text-muted" },
  "subagent-start": { glyph: "↳", tone: "text-muted" },
  "subagent-stop": { glyph: "↲", tone: "text-muted" },
  commit: { glyph: "◆", tone: "text-accent" },
  "pr-opened": { glyph: "⇡", tone: "text-success" },
  "pr-merged": { glyph: "⇡", tone: "text-merged" },
  "pr-closed": { glyph: "⇡", tone: "text-muted" },
  "pr-failing": { glyph: "⇡", tone: "text-error" },
  "pr-passing": { glyph: "⇡", tone: "text-success" },
  "pr-conflict": { glyph: "⇡", tone: "text-error" },
  "pr-changes": { glyph: "⇡", tone: "text-warning" },
}

export const LOOK_OTHER: KindLook = { glyph: "·", tone: "text-muted" }

export type Jump =
  | { readonly to: "tab"; readonly tabId: string }
  | { readonly to: "diff" }
  | { readonly to: "pr"; readonly url: string }

/** Where a row's click goes; a row about nothing the page can show goes nowhere. */
export function jumpOf(row: TimelineRow): Jump | null {
  if (row.kind === "commit") return { to: "diff" }
  if (row.kind.startsWith("pr-")) return row.url ? { to: "pr", url: row.url } : null
  return row.tabId ? { to: "tab", tabId: row.tabId } : null
}

/**
 * What changed between two reads of a task's PR, as row kinds. A PR still `unknown` has not been
 * polled, so its check state is not a change yet; no earlier PR means the PR was just opened.
 */
export function prChanges(prev: TaskRowPr | null | undefined, next: TaskRowPr | null | undefined): string[] {
  if (!next) return []
  if (!prev) return ["pr-opened"]
  const out: string[] = []
  if (prev.lifecycle !== next.lifecycle) {
    if (next.lifecycle === "merged") out.push("pr-merged")
    else if (next.lifecycle === "closed") out.push("pr-closed")
  }
  if (prev.lifecycle === "unknown") return out
  if (prev.checkState !== next.checkState) {
    if (next.checkState === "failing") out.push("pr-failing")
    else if (next.checkState === "passing") out.push("pr-passing")
  }
  const conflict = (pr: TaskRowPr) => (pr.mergeable ?? "").toUpperCase() === "CONFLICTING"
  if (conflict(next) && !conflict(prev)) out.push("pr-conflict")
  const changes = (pr: TaskRowPr) => (pr.reviewDecision ?? "").toUpperCase() === "CHANGES_REQUESTED"
  if (changes(next) && !changes(prev)) out.push("pr-changes")
  return out
}

/** The bridge's entries and this page's PR changes, newest first. */
export function mergeRows(served: readonly TimelineRow[], seen: readonly TimelineRow[]): TimelineRow[] {
  return [...served, ...seen].sort((a, b) => b.at - a.at)
}
