/**
 * What every client shows for a task and each of its tabs, decided once, here.
 * Pure: `row-status-store.ts` gathers the inputs (the activity ledger, the
 * attention inbox, the PTY host's sessions, who is looking at what, task jobs
 * and deletion) and calls these; the TUI sidebar, its tab strip, the web rail
 * and the mobile clients only map the result to their own glyphs
 * (`rove/src/lib/row-status-glyph.ts`).
 *
 * One tab's state, highest first: an attention state (rate limited, error,
 * dead) → running → needs input → a finished turn nobody has looked at → idle.
 * An attention state or a question the user has since handled (answered it, or
 * its Inbox episode went) shows idle until the engine reports again, so the rail
 * never says more than the Inbox. A freeze-restored session is attention while
 * its `restored` Inbox episode is pending. The task row: a job
 * or deletion, else its most urgent tab, ranked running → needs input →
 * attention → unseen → idle.
 */

import type { TaskActivityState } from "./contracts.ts"
import { STATUS_PRIORITY } from "./status-priority.ts"

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
  /** The engine running in the tab now, when it is not necessarily the task's own (one started by hand in its shell). */
  readonly engine?: string
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
  /** When the user last handled this tab: answered its question, or its Inbox episode left. */
  readonly handledAt?: number
  /** From the PTY host's session list; undefined when the host did not answer. */
  readonly session?: { readonly alive: boolean; readonly restored: boolean }
  /** The engine the last foreground walk found in the session. */
  readonly engine?: string
}

const ATTENTION_STATES: ReadonlySet<string> = new Set(["rate_limited", "error", "dead"])

export function tabStatus(input: TabStatusInput): TabStatus {
  const session = {
    alive: input.session?.alive ?? false,
    restored: input.session?.restored ?? false,
    tracked: input.activity !== undefined || input.pending !== undefined,
    ...(input.engine && input.session?.alive ? { engine: input.engine } : {}),
  }
  const a = input.activity
  const handled = a !== undefined && input.handledAt !== undefined && input.handledAt >= a.at
  if (session.restored && input.pending?.state === "restored") {
    return { kind: "attention", reason: "restored", since: input.pending.at, ...session }
  }
  if (a && ATTENTION_STATES.has(a.state) && !handled) {
    return { kind: "attention", reason: a.state as RowStatusReason, since: a.at, state: a.state, ...session }
  }
  if (a?.state === "running") return { kind: "running", since: a.at, state: a.state, ...session }
  if (a?.state === "permission_needed" && !handled) {
    return { kind: "needs-input", since: a.at, state: a.state, ...session }
  }
  // Unseen is the inbox's to say: an episode no client has opened, and nobody looking right now.
  if (input.pending && !input.viewed && input.pending.state === "turn_complete") {
    return { kind: "unseen", since: input.pending.at, ...(a ? { state: a.state } : {}), ...session }
  }
  return { kind: "idle", since: a?.at ?? 0, ...(a ? { state: a.state } : {}), ...session }
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
    const better =
      STATUS_PRIORITY[status.kind] < STATUS_PRIORITY[best.kind] ||
      (status.kind === best.kind && status.since > best.since)
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
