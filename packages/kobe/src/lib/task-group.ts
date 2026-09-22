/**
 * The DERIVED task group — "whose turn is it" — computed from stored signals,
 * never declared. `status` is only a claim (a crashed worker stays
 * `in_progress` forever); this reads facts with owners:
 *
 *   - `task.report`      the worker's own claim of what it delivered
 *   - `task.prStatus`    the daemon's OBSERVATION of the forge
 *   - activity           arbitrated per-tab engine state (hook > observed,
 *                        see docs/design/engine-internals.md)
 *   - tab liveness       pty-host process truth
 *   - `task.deletion` / `task.quotaResume` / the record's timestamps
 *
 * Pure (pass `now`). A new group is a new rule here, never a field on disk.
 *
 * Absence is never a verdict: unreadable activity with nothing else to stand
 * on is `unknown`, NOT `idle` — `idle` means "we looked", and a coordinator
 * acts on it.
 */

import type { TaskActivityState } from "@/engine/hook-events"
import type { TaskPRStatus, TaskStatus, TaskWorkerReport } from "@/types/task"

/** In RANK order (most-needs-you first); array order IS {@link taskGroupRank}. */
export const TASK_GROUPS = [
  /** Permission prompt, quota wall that won't clear itself, settled error,
   *  or a dead tab that delivered nothing. */
  "waiting-on-you",
  /** PR open and approved — one merge away. */
  "landing",
  /** A report or finished turn nobody has acted on. */
  "ready-for-review",
  /** An engine is producing output, or will be resumed on a timer. */
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
 * How long `error` must stand before it waits on a person: a self-retrying
 * engine fires `turn-failed` then `turn-start` seconds apart. Matches the
 * daemon's `DEFAULT_CORRECT_AFTER_MS`.
 */
export const ERROR_SETTLE_MS = 20_000

/**
 * How long a dead/absent tab must stay so before it waits on a person. A death
 * inside a live PTY is only seen on the foreground WALK, ~once per 60s
 * (`DEFAULT_WALK_EVERY_TICKS` × `DEFAULT_OBSERVER_POLL_MS`); a respawn inside
 * one cadence is invisible.
 */
export const DEAD_SETTLE_MS = 60_000

// `permission_needed` / `rate_limited` get NO debounce: hook events with
// turn-boundary precision that observation never retracts.

/** Arbitrated engine activity for a task, or `null`/`undefined` = not read. */
export interface TaskActivitySignal {
  readonly state: TaskActivityState
  /** Epoch ms of the transition into {@link state}. */
  readonly at: number
}

/** Structural (not `Task`) so CLI `SerializedTask` and TUI `Task` both fit uncast. Only fields the rules read. */
interface TaskGroupTask {
  readonly status: TaskStatus
  readonly report?: TaskWorkerReport
  readonly prStatus?: TaskPRStatus
  readonly deletion?: { readonly phase: "queued" | "running" | "error" }
  readonly quotaResume?: { readonly resumeAt: string }
}

export interface TaskGroupInput {
  readonly task: TaskGroupTask
  /** `null`/absent = could NOT be read, never idle (idle is `{ state: "idle" }`). */
  readonly activity?: TaskActivitySignal | null
  /** Any hosted engine tab alive; `null`/absent = could not ask, refutes nothing. */
  readonly tabAlive?: boolean | null
  /** Epoch ms. */
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
 * FIRST MATCH WINS, in an order that is not rank order: `working` is tested
 * before `landing`/`ready-for-review` because a live engine makes them
 * provisional (it may be replacing the approved commits), yet ranks below them
 * since it needs nothing from a person.
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
  // Needs `activity`: otherwise a crashed engine and a never-started one look alike.
  if (activity && !task.report && age >= DEAD_SETTLE_MS && (state === "dead" || input.tabAlive === false))
    return "waiting-on-you"

  // 2. An agent is on it. `running` on a tab the pty host says is dead is a
  //    stale hook claim (outlived a daemon restart).
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

  // 5. Quiet — only if the engine signal answered; a PR observation can't buy `idle`.
  return activity ? "idle" : "unknown"
}

/** {@link deriveTaskGroup} plus its sort key — what callers usually want. */
export function taskGroupOf(input: TaskGroupInput): { readonly group: TaskGroup; readonly rank: number } {
  const group = deriveTaskGroup(input)
  return { group, rank: taskGroupRank(group) }
}
