/**
 * Scheduled automations ("routines") — the schedule record, its run history,
 * and the patch shape edits take.
 *
 * Their own module along a real seam: nothing else in the daemon's contracts
 * refers to these, and they are the one group with their own store, runner,
 * and RPC family.
 */

import type { VendorId } from "./contracts.ts"

/** Back-pointer from a routine's standing session task to its schedule.
 *  Lives here rather than beside the task types because the id it carries is
 *  an {@link Automation}'s. */
export interface TaskRoutineLink {
  readonly automationId: string
}

/** A shell command run BEFORE an automation's engine starts. A non-zero exit
 *  means "nothing to do" and the run is skipped without spawning an engine —
 *  the cheap way to stop a schedule burning a turn when nothing changed. */
export interface AutomationPrecheck {
  readonly command: string
  readonly timeoutSeconds: number
}

/**
 * One scheduled agent task: a cron rule + a prompt + a repo. By default every
 * firing creates a FRESH task (worktree + branch + engine session), so an
 * automation run is an ordinary task you can open and keep talking to.
 * {@link persistentSession} swaps that for one standing task the schedule
 * re-delivers into, which is what lets a daily routine build on yesterday.
 *
 * `nextRunAt` is the whole scheduling story: an absolute timestamp on disk,
 * never an in-memory timer. A daemon restart needs no re-arm pass — the first
 * sweep after boot re-reads it (same shape as `Task.quotaResume`).
 */
export interface Automation {
  readonly id: string
  readonly name: string
  /** Absolute repo root; resolved once at create time. */
  readonly repo: string
  /** Delivered as the engine's launch-time first message. */
  readonly prompt: string
  readonly vendor?: VendorId
  /** Five-field cron, evaluated in the daemon host's local time. */
  readonly schedule: string
  readonly precheck?: AutomationPrecheck
  readonly baseRef?: string
  /**
   * Re-deliver into ONE standing task instead of creating a fresh worktree
   * per firing. Off by default, and deliberately per-routine:
   * an inspection routine wants yesterday's context, while a routine that
   * EDITS code wants a clean branch it can land — piling a week of runs onto
   * one branch makes it unlandable.
   */
  readonly persistentSession?: boolean
  /**
   * The standing task {@link persistentSession} delivers into. Set on the
   * first firing, cleared when that task is gone (deleted, or its worktree
   * removed) so the next firing rebuilds rather than failing forever.
   */
  readonly sessionTaskId?: string
  readonly enabled: boolean
  /** ISO-8601. The single source of truth for when this fires next. */
  readonly nextRunAt: string
  /** How late a missed occurrence may still run. Older ones are skipped. */
  readonly missedRunGraceMinutes: number
  /**
   * The scheduled time of the most recent occurrence the sweep CONSUMED —
   * stamped by `advanceNextRun` before the dispatch is even attempted, so it
   * is set for skips and failures exactly as it is for successes.
   *
   * Named for what it is. As `lastRunAt` it was in the `automation.list`
   * payload claiming a run had happened for routines that had only ever
   * recorded `skipped_unavailable`, which is the one conclusion that makes a
   * reader stop looking. "When did it last actually run, and what happened" is
   * `automation.runs`, which answers with a status attached.
   */
  readonly lastOccurrenceAt?: string
  readonly createdAt: string
  readonly updatedAt: string
}

/**
 * Why a run did or did not produce work. The "didn't run" reasons are
 * deliberately distinct: unattended automation is only trustworthy if the user
 * can tell "nothing to do" (`skipped_precheck`, healthy) from "it broke"
 * (`dispatch_failed`, needs a human) at a glance. The same rule is why a
 * standing session's degraded paths (`revived`, `deferred`) are not folded
 * into `dispatched`.
 */
export type AutomationRunStatus =
  | "dispatched"
  /**
   * A standing session whose engine had died was respawned in the
   * same worktree. Distinct from `dispatched` because the files carried over
   * but the CONVERSATION did not — a run that answered without yesterday's
   * context in front of it should not read as one that had it.
   */
  | "revived"
  /**
   * The standing session's composer was busy, so the daemon took ownership of
   * the prompt and queued it for a human to release from the Inbox. A SUCCESS
   * (the report is not lost), and deliberately not `dispatch_failed`.
   */
  | "deferred"
  | "skipped_precheck"
  | "skipped_missed"
  | "skipped_unavailable"
  | "dispatch_failed"

export interface AutomationPrecheckResult {
  readonly exitCode: number | null
  readonly timedOut: boolean
  readonly stdout: string
  readonly stderr: string
  readonly durationMs: number
}

export interface AutomationRun {
  readonly id: string
  readonly automationId: string
  /** Monotonic per automation; survives retention pruning. */
  readonly runNumber: number
  /** When this occurrence was SUPPOSED to run — not when it actually did. */
  readonly scheduledFor: string
  readonly status: AutomationRunStatus
  readonly trigger: "scheduled" | "manual"
  readonly taskId?: string
  readonly precheckResult?: AutomationPrecheckResult
  readonly error?: string
  /** ISO-8601 event time. */
  readonly at: string
}

/** Mutable fields of an automation. `schedule` changes recompute `nextRunAt`. */
export interface AutomationPatch {
  readonly name?: string
  readonly prompt?: string
  readonly vendor?: VendorId
  readonly schedule?: string
  readonly precheck?: AutomationPrecheck | null
  readonly baseRef?: string | null
  readonly enabled?: boolean
  readonly missedRunGraceMinutes?: number
  readonly persistentSession?: boolean
  /** `null` clears the standing session link; absent leaves it untouched. */
  readonly sessionTaskId?: string | null
}
