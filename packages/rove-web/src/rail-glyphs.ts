/** Status marks a rail row draws: the dot look, the tone palette, and the rollups over a folded group. */

import type { RowStatus, TaskRow, TaskRowPr } from "rove-bridge/protocol"

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
  /** nf-oct-git_pull_request / git_merge / git_pull_request_closed: a task's PR, by where it stands. */
  prOpen: "\u{f407}",
  prMerged: "\u{f419}",
  prClosed: "\u{f4dc}",
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

export interface PrMark {
  readonly glyph: string
  /** A class from `styles.css`'s tone set. */
  readonly tone: "tone-success" | "tone-attention" | "tone-merged" | "muted"
  /** `rail.pr.state.*` and, for an open PR, `rail.pr.checks.*`: the hover's words. */
  readonly state: "open" | "merged" | "closed"
  readonly checks?: "conflict" | "failing" | "passing" | "pending"
}

/**
 * A PR as the rail draws it, after GitHub and Claude's list: the PR's own icon in its
 * lifecycle's colour, red while it can't land, grey when the forge was unreachable last poll.
 * An unpolled PR (`unknown`) draws as an open one with no check state.
 */
export function prMarkOf(
  pr: TaskRowPr | null | undefined,
  chip: TaskRow["prChip"] | undefined,
  stale: boolean,
): PrMark | null {
  if (!pr) return null
  if (pr.lifecycle === "merged") return { glyph: NERD.prMerged, tone: stale ? "muted" : "tone-merged", state: "merged" }
  if (pr.lifecycle === "closed") return { glyph: NERD.prClosed, tone: "muted", state: "closed" }
  if (pr.lifecycle !== "open" && pr.lifecycle !== "ready_to_merge" && pr.lifecycle !== "unknown") return null
  const checks =
    chip === "conflict"
      ? "conflict"
      : chip === "failing"
        ? "failing"
        : chip === "passing"
          ? "passing"
          : pr.checkState === "pending"
            ? "pending"
            : undefined
  const tone = stale
    ? "muted"
    : checks === "conflict" || checks === "failing"
      ? "tone-attention"
      : checks === "passing"
        ? "tone-success"
        : "muted"
  return { glyph: NERD.prOpen, tone, state: "open", ...(checks ? { checks } : {}) }
}

/** A task's own branch PR as the rail draws it. */
export function prMark(task: Pick<TaskRow, "pr" | "prChip" | "prChipStale">): PrMark | null {
  return prMarkOf(task.pr, task.prChip, task.prChipStale === true)
}

/** A session PR carries no row chip: the same conflict > failing > passing rule, read off its own status. */
export function sessionPrMark(pr: TaskRowPr): PrMark | null {
  const chip =
    (pr.mergeable ?? "").toUpperCase() === "CONFLICTING"
      ? "conflict"
      : pr.checkState === "failing"
        ? "failing"
        : pr.checkState === "passing"
          ? "passing"
          : null
  return prMarkOf(pr, chip, false)
}

/** The mark a row with several PRs leads with: an open one that can't land, any other open one, merged, closed. */
export function leadPrMark(marks: readonly PrMark[]): PrMark | undefined {
  const rank = (mark: PrMark) =>
    mark.state === "open" ? (mark.tone === "tone-attention" ? 0 : 1) : mark.state === "merged" ? 2 : 3
  return [...marks].sort((a, b) => rank(a) - rank(b))[0]
}
