/** Status marks a rail row draws: the dot look, the tone palette, and the rollups over a folded group. */

import type { RowStatus, TaskRow } from "rove-bridge/protocol"

export type Tone = "accent" | "muted" | "attention" | "warning" | "success" | "info" | "ink"

/** What a row's 3×3 dot mark draws (`status-dots.tsx`, after ELYTerminal's orb). */
export type DotLook = "working" | "waiting" | "error" | "done" | "idle"

/** The colour of each look, as ELYTerminal's session row picks it (`src/sessions.rs`). */
const LOOK_TONE: Readonly<Record<DotLook, Tone>> = {
  working: "info",
  waiting: "warning",
  error: "attention",
  done: "success",
  idle: "muted",
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
  const look = dotLook(status)
  return { look, tone: LOOK_TONE[look] }
}

function dotLook(status: RowStatus | undefined): DotLook {
  switch (status?.kind) {
    case "busy":
    case "running":
      return "working"
    case "needs-input":
      return "waiting"
    case "attention":
      return status.reason === "rate_limited" ? "waiting" : "error"
    case "unseen":
      return "done"
    default:
      return "idle"
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
