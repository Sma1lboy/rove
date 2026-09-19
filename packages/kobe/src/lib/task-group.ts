/**
 * The DERIVED task group — "whose turn is it", computed from signals Rove
 * already stores, never declared.
 *
 * A task's `status` is a CLAIM: `set-status` is written by a worker or a
 * human, so a worker that crashed mid-run stays `in_progress` forever and the
 * board reads as busy when nothing is running. This function answers the
 * question the status field was being asked to answer and cannot — is anyone
 * blocked on ME — from facts with owners:
 *
 *   - `task.report`      the worker's own claim of what it delivered
 *   - `task.prStatus`    the daemon's OBSERVATION of the forge
 *   - activity           arbitrated per-tab engine state (hook > observed,
 *                        see docs/design/engine-internals.md)
 *   - tab liveness       pty-host process truth
 *   - `task.deletion` / `task.quotaResume` / the record's timestamps
 *
 * Pure: no clock of its own (pass `now`), no I/O, no storage. Adding a group
 * means adding a rule here, never a new field on disk.
 *
 * ## Absence is never a verdict
 *
 * `null` ≠ `false` throughout `docs/API.md`, and it holds here: a task whose
 * activity could not be read, with nothing else stored to stand on, is
 * `unknown` — NOT `idle`. `idle` claims "we looked, nothing is happening",
 * which is a thing a coordinator acts on.
 */

import type { TaskActivityState } from "@/engine/hook-events"
import type { TaskPRStatus, TaskStatus, TaskWorkerReport } from "@/types/task"

/**
 * One group, in RANK order — the human's queue, most-needs-you first. The
 * order of the union is the order of the ranks; see {@link taskGroupRank}.
 */
export const TASK_GROUPS = [
  /** Blocked on a person: a permission prompt, a quota wall nothing will
   *  clear on its own, a settled error, a dead tab that delivered nothing. */
  "waiting-on-you",
  /** The PR is open and approved — one merge away from done. */
  "landing",
  /** Something was handed back (a report, or a finished turn) and nobody has
   *  acted on it yet. */
  "ready-for-review",
  /** An engine is producing output, or the daemon will resume it on a timer.
   *  Nothing for a person to do. */
  "working",
  /** We looked; nothing is happening. */
  "idle",
  /** We could not look. Distinct from `idle` on purpose. */
  "unknown",
] as const

export type TaskGroup = (typeof TASK_GROUPS)[number]

/** Sort key: 0 needs you most. Ties break on whatever the caller already uses. */
export function taskGroupRank(group: TaskGroup): number {
  return TASK_GROUPS.indexOf(group)
}

/**
 * How long a reported `error` must stand before it counts as waiting on a
 * person. An engine that fails a turn and starts another one by itself fires
 * `turn-failed` then `turn-start` seconds apart; summoning a human into that
 * gap is the noise this whole derivation exists to avoid. 20s is
 * `DEFAULT_CORRECT_AFTER_MS` — the daemon's own "wait this long before
 * believing a claim a fresher signal could overturn".
 */
export const ERROR_SETTLE_MS = 20_000

/**
 * How long a dead/absent engine tab must stay that way before it counts as
 * waiting on a person. An engine that dies inside a still-live PTY is only
 * observable on the foreground WALK, one sample per ~60s
 * (`DEFAULT_WALK_EVERY_TICKS` × `DEFAULT_OBSERVER_POLL_MS`). Below one walk
 * cadence the death has been seen once at most, and a respawn inside the
 * window is invisible to us.
 */
export const DEAD_SETTLE_MS = 60_000

/**
 * `permission_needed` and `rate_limited` get NO debounce: both are engine
 * HOOK events with turn-boundary precision, and neither is ever retracted by
 * observation. A screen-read blocked state would need a debounce because it
 * flickers; these do not, and delaying them would slow down the one group the
 * feature exists to surface.
 */

/** Arbitrated engine activity for a task, or `null`/`undefined` = not read. */
export interface TaskActivitySignal {
  readonly state: TaskActivityState
  /** Epoch ms of the transition into {@link state}. */
  readonly at: number
}

/**
 * The stored half of the input — structural, not `Task`, so the CLI's
 * `SerializedTask` and the TUI's `Task` both satisfy it without a cast.
 * Exactly the fields the rules below read; adding one here is the honest
 * signal that a rule grew a new dependency.
 */
export interface TaskGroupTask {
  readonly status: TaskStatus
  readonly report?: TaskWorkerReport
  readonly prStatus?: TaskPRStatus
  readonly deletion?: { readonly phase: "queued" | "running" | "error" }
  readonly quotaResume?: { readonly resumeAt: string }
}

export interface TaskGroupInput {
  readonly task: TaskGroupTask
  /**
   * The task's effective engine activity. `null`/absent means the signal
   * could NOT be read (daemon restarted, no entry) — it never means idle.
   * A known-idle answer arrives as `{ state: "idle" }`.
   */
  readonly activity?: TaskActivitySignal | null
  /**
   * Whether any hosted engine tab is alive (pty-host process truth).
   * `null`/absent = could not ask, which refutes nothing.
   */
  readonly tabAlive?: boolean | null
  /** Epoch ms. Passed in so the function stays pure and testable. */
  readonly now: number
}

/** Has somebody already acted on what this task handed back? */
function actedOn(task: TaskGroupTask): boolean {
  if (task.status === "done" || task.status === "canceled") return true
  const lifecycle = task.prStatus?.lifecycle
  return lifecycle === "merged" || lifecycle === "closed"
}

/** The daemon will resume this task itself once the quota window rolls. */
function autoResumes(task: TaskGroupTask, now: number): boolean {
  const at = task.quotaResume?.resumeAt
  if (!at) return false
  const ms = Date.parse(at)
  return !Number.isNaN(ms) && ms > now
}

/**
 * Which group a task is in. FIRST MATCH WINS, and the match order is
 * deliberately not the rank order: `working` is tested before `landing` and
 * `ready-for-review` because a live engine makes every other signal
 * provisional — a PR approved two minutes ago describes commits the engine
 * may already have replaced. It still RANKS below both, because a busy agent
 * is the one state with nothing in it for a person.
 */
export function deriveTaskGroup(input: TaskGroupInput): TaskGroup {
  const { task, now } = input
  const activity = input.activity ?? null
  const state = activity?.state
  const age = activity ? Math.max(0, now - activity.at) : 0

  // 1. Blocked on a person.
  if (task.deletion?.phase === "error") return "waiting-on-you"
  if (state === "permission_needed") return "waiting-on-you"
  if (state === "rate_limited" && !autoResumes(task, now)) return "waiting-on-you"
  if (state === "error" && age >= ERROR_SETTLE_MS) return "waiting-on-you"
  // A dead tab that delivered nothing. `activity` must exist: without it we
  // cannot tell a crashed engine from a task whose engine never started.
  if (activity && !task.report && age >= DEAD_SETTLE_MS && (state === "dead" || input.tabAlive === false))
    return "waiting-on-you"

  // 2. An agent is on it.
  //    A `running` claim about a tab the pty host says is NOT alive is stale
  //    (a hook claim outliving a daemon restart) — it must not read as work
  //    in progress.
  if (state === "running" && input.tabAlive !== false) return "working"
  if (state === "rate_limited") return "working" // auto-resume is scheduled

  // 3. Approved and open — the merge is the person's move.
  const pr = task.prStatus
  if (
    (pr?.lifecycle === "open" || pr?.lifecycle === "ready_to_merge") &&
    (pr.reviewDecision ?? "").toUpperCase() === "APPROVED"
  )
    return "landing"

  // 4. Handed back, nobody has looked.
  if ((task.report !== undefined || state === "turn_complete") && !actedOn(task)) return "ready-for-review"

  // 5. Quiet — but only when the engine signal actually answered. A stored
  //    PR observation says nothing about whether an agent is running, so it
  //    cannot buy an `idle` verdict.
  return activity ? "idle" : "unknown"
}

/** {@link deriveTaskGroup} plus its sort key — what callers usually want. */
export function taskGroupOf(input: TaskGroupInput): { readonly group: TaskGroup; readonly rank: number } {
  const group = deriveTaskGroup(input)
  return { group, rank: taskGroupRank(group) }
}
