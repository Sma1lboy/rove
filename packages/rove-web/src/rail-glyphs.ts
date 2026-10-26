/** Status marks a rail row draws: the dot look, the tone palette, and the rollups over a folded group. */

import { type RowTone, rowStatusTone } from "@sma1lboy/rove/src/lib/row-status-glyph.ts"
import type { RowStatus, TaskRow } from "rove-bridge/protocol"

export type Tone = "accent" | "muted" | "attention" | "warning" | "success" | "ink"

/** What a row's 3×3 dot mark draws (`status-dots.tsx`, after ELYTerminal's orb). */
export type DotLook = "working" | "waiting" | "error" | "done" | "idle"

/** The web palette for a status tone: a wait you can clear is amber, what stays broken is red. */
const TONE: Readonly<Record<RowTone, Tone>> = {
  accent: "accent",
  warning: "warning",
  error: "attention",
  muted: "muted",
}

/** Nerd Font icons the rail draws (the font ships with the page, `styles.css`). */
export const NERD = {
  /** nf-oct-git_branch: a child in its own worktree. */
  branch: "\u{f418}",
  /** nf-oct-file_directory: a child sharing its parent's directory. */
  shared: "\u{f413}",
  /** nf-oct-chevron_down / nf-oct-chevron_right: a parent's fold. */
  unfolded: "\u{f47c}",
  folded: "\u{f460}",
} as const

export interface StatusMark {
  readonly look: DotLook
  readonly tone: Tone
}

/** A daemon status as a rail draws it; no status (no reading yet) is a quiet row. A rate limit clears itself, so it waits rather than fails. */
export function statusMark(status: RowStatus | undefined): StatusMark {
  const tone = TONE[rowStatusTone(status)]
  switch (status?.kind) {
    case "busy":
    case "running":
      return { look: "working", tone }
    case "needs-input":
      return { look: "waiting", tone }
    case "attention":
      return { look: status.reason === "rate_limited" ? "waiting" : "error", tone }
    case "unseen":
      return { look: "done", tone }
    default:
      return { look: "idle", tone }
  }
}

/** A folded group's rows that need a person: something to answer or something broken. */
export function needsPerson(task: TaskRow): boolean {
  return task.rowStatus?.kind === "needs-input" || task.rowStatus?.kind === "attention"
}

// `rove-daemon/daemon/row-status.ts` RANK (not importable here): what a task row ranks its tabs by.
const URGENCY: Readonly<Record<RowStatus["kind"], number>> = {
  busy: 0,
  attention: 1,
  "needs-input": 2,
  running: 3,
  unseen: 4,
  idle: 5,
}

/** The most urgent rollup among `tasks` (a folded parent's hidden children), or undefined when none has a status yet. */
export function mostUrgentStatus(tasks: readonly TaskRow[]): RowStatus | undefined {
  let best: RowStatus | undefined
  for (const { rowStatus: status } of tasks) {
    if (!status) continue
    if (!best || URGENCY[status.kind] < URGENCY[best.kind]) best = status
    else if (status.kind === best.kind && status.since > best.since) best = status
  }
  return best
}
