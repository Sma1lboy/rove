/**
 * What every client shows for a task and each of its tabs, decided once, here.
 * Pure: `row-status-store.ts` gathers the inputs (the activity ledger, the
 * attention inbox, the PTY host's sessions, who is looking at what, task jobs
 * and deletion) and calls these; the TUI sidebar, its tab strip, the web rail
 * and the mobile clients only map the result to their own glyphs
 * (`rove/src/lib/row-status-glyph.ts`).
 *
 * Precedence, highest first (the TUI sidebar's, `tui/panes/sidebar/row-view.ts`):
 * a task-level job or deletion → an attention state (rate limited, error, dead,
 * a freeze-restored session) → running → needs input (unless just answered) →
 * a finished turn nobody has looked at → idle.
 */

import type { TaskActivityState } from "./contracts.ts"

export type RowStatusKind =
  /** A task-level operation in flight: worktree being created, task being deleted. */
  | "busy"
  | "attention"
  | "running"
  | "needs-input"
  /** The engine finished a turn and no client has looked at it since. */
  | "unseen"
  | "idle"

/** Why an `attention` (or `busy`) row is one. */
export type RowStatusReason = "rate_limited" | "error" | "dead" | "restored" | "job" | "deleting" | "delete_failed"

export interface RowStatus {
  readonly kind: RowStatusKind
  readonly reason?: RowStatusReason
  /** When the row entered this state (ms epoch); 0 when unknown. */
  readonly since: number
  /** The activity ledger's raw state, when it has one. */
  readonly state?: TaskActivityState
}

export interface TabStatus extends RowStatus {
  /** The tab's PTY session is alive. False for a closed session or one never started. */
  readonly alive: boolean
  /** A session restored from a host restart and not yet reopened (its ring only). */
  readonly restored: boolean
  /** Some engine reported on this tab (hooks or observation): its status is tracked, not guessed. */
  readonly tracked: boolean
}

export interface TaskStatus {
  /** The task's rollup: what a folded row, or a task with no tab list, shows. */
  readonly task: RowStatus
  readonly tabs: Readonly<Record<string, TabStatus>>
}

export interface TabStatusInput {
  /** The ledger's effective state for this tab, if it has one. */
  readonly activity?: { readonly state: TaskActivityState; readonly at: number }
  /** An inbox episode for this tab: the turn's result nobody opened yet. */
  readonly pending?: { readonly state: string; readonly at: number }
  /** A client is looking at this tab now. */
  readonly viewed: boolean
  /** When a client last answered this tab's question (`activity.answered`). */
  readonly answeredAt?: number
  /** From the PTY host's session list; undefined when the host did not answer. */
  readonly session?: { readonly alive: boolean; readonly restored: boolean }
}

const ATTENTION_STATES: ReadonlySet<string> = new Set(["rate_limited", "error", "dead"])

export function tabStatus(input: TabStatusInput): TabStatus {
  const session = {
    alive: input.session?.alive ?? false,
    restored: input.session?.restored ?? false,
    tracked: input.activity !== undefined || input.pending !== undefined,
  }
  const a = input.activity
  if (session.restored) return { kind: "attention", reason: "restored", since: a?.at ?? 0, ...session }
  if (a && ATTENTION_STATES.has(a.state)) {
    return { kind: "attention", reason: a.state as RowStatusReason, since: a.at, state: a.state, ...session }
  }
  if (a?.state === "running") return { kind: "running", since: a.at, state: a.state, ...session }
  if (a?.state === "permission_needed" && !(input.answeredAt !== undefined && input.answeredAt >= a.at)) {
    return { kind: "needs-input", since: a.at, state: a.state, ...session }
  }
  // Unseen is the inbox's to say: an episode no client has opened, and nobody looking right now.
  if (input.pending && !input.viewed && input.pending.state === "turn_complete") {
    return { kind: "unseen", since: input.pending.at, ...(a ? { state: a.state } : {}), ...session }
  }
  return { kind: "idle", since: a?.at ?? 0, ...(a ? { state: a.state } : {}), ...session }
}

const RANK: Readonly<Record<RowStatusKind, number>> = {
  busy: 0,
  attention: 1,
  "needs-input": 2,
  running: 3,
  unseen: 4,
  idle: 5,
}

/**
 * The task row: a task-level job or deletion wins, else the most urgent tab
 * (the tab-less hook entry counts as one more tab), most recent on a tie.
 */
export function taskStatus(
  tabs: Readonly<Record<string, TabStatus>>,
  extra: {
    readonly tabless?: RowStatus
    readonly job?: { readonly at: number }
    readonly deletion?: { readonly failed: boolean; readonly at: number }
  } = {},
): RowStatus {
  if (extra.deletion?.failed) return { kind: "attention", reason: "delete_failed", since: extra.deletion.at }
  if (extra.deletion) return { kind: "busy", reason: "deleting", since: extra.deletion.at }
  if (extra.job) return { kind: "busy", reason: "job", since: extra.job.at }
  let best: RowStatus = { kind: "idle", since: 0 }
  for (const status of [...Object.values(tabs), ...(extra.tabless ? [extra.tabless] : [])]) {
    const better = RANK[status.kind] < RANK[best.kind] || (status.kind === best.kind && status.since > best.since)
    if (better)
      best = {
        kind: status.kind,
        since: status.since,
        ...(status.reason ? { reason: status.reason } : {}),
        ...(status.state ? { state: status.state } : {}),
      }
  }
  return best
}

export function sameTaskStatus(a: TaskStatus | undefined, b: TaskStatus): boolean {
  return a !== undefined && JSON.stringify(a) === JSON.stringify(b)
}
