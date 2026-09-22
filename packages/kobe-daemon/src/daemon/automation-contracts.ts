/** Scheduled automations ("routines"): the schedule record, its run history, and the edit patch. */

import type { VendorId } from "./contracts.ts"

/** Back-pointer from a routine's standing session task to its {@link Automation}. */
export interface TaskRoutineLink {
  readonly automationId: string
}

/** Shell command run BEFORE the engine starts; a non-zero exit means "nothing
 *  to do" and skips the run without spawning an engine. */
export interface AutomationPrecheck {
  readonly command: string
  readonly timeoutSeconds: number
}

/**
 * A cron rule + a prompt + a repo. By default every firing creates a FRESH
 * task (worktree + branch + engine session); {@link persistentSession}
 * re-delivers into one standing task instead.
 *
 * `nextRunAt` is an absolute on-disk timestamp, never an in-memory timer, so
 * a restart needs no re-arm pass (same shape as `Task.quotaResume`).
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
   * Re-deliver into ONE standing task instead of a fresh worktree per firing.
   * Off by default and per-routine: a routine that EDITS code needs a clean,
   * landable branch, not a week of runs piled onto one.
   */
  readonly persistentSession?: boolean
  /** Exact user-owned conversation. Never creates or revives a task or tab. */
  readonly target?: { readonly kind: "existing-tab"; readonly taskId: string; readonly tabId: string }
  /** The standing task {@link persistentSession} delivers into. Set on the
   *  first firing; cleared when that task or its worktree is gone, so the next
   *  firing rebuilds. */
  readonly sessionTaskId?: string
  readonly enabled: boolean
  /** ISO-8601. The single source of truth for when this fires next. */
  readonly nextRunAt: string
  /** How late a missed occurrence may still run. Older ones are skipped. */
  readonly missedRunGraceMinutes: number
  /**
   * Scheduled time of the latest occurrence the sweep CONSUMED, stamped by
   * `advanceNextRun` before dispatch, so skips and failures set it too. Not
   * evidence of a run: `automation.runs` has the statuses.
   */
  readonly lastOccurrenceAt?: string
  readonly createdAt: string
  readonly updatedAt: string
}

/**
 * Why a run did or did not produce work. Kept distinct so "nothing to do"
 * (`skipped_precheck`) reads apart from "it broke" (`dispatch_failed`), and
 * `revived` apart from `dispatched`.
 */
export type AutomationRunStatus =
  | "dispatched"
  /** Dead standing-session engine respawned in the same worktree: files
   *  carried over, the CONVERSATION did not. */
  | "revived"
  | "skipped_cancelled"
  | "skipped_precheck"
  | "skipped_missed"
  | "skipped_unavailable"
  | "dispatch_failed"

/**
 * Outcomes that repeat every firing until a human intervenes
 * (`skipped_precheck` must never alarm). The one definition the Inbox and the
 * Routines list share, so they agree on which routines are broken.
 */
export function automationRunNeedsAttention(status: AutomationRunStatus): boolean {
  return status === "dispatch_failed" || status === "skipped_unavailable"
}

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
  readonly tabId?: string
  readonly precheckResult?: AutomationPrecheckResult
  readonly error?: string
  /** ISO-8601 event time. */
  readonly at: string
}

/** Mutable fields of an automation. `schedule` changes recompute `nextRunAt`. */
export interface AutomationPatch {
  readonly name?: string
  readonly prompt?: string
  readonly vendor?: VendorId | null
  readonly schedule?: string
  readonly precheck?: AutomationPrecheck | null
  readonly baseRef?: string | null
  readonly enabled?: boolean
  readonly missedRunGraceMinutes?: number
  readonly persistentSession?: boolean
  /** Exact user-owned conversation. Never creates or revives a task or tab. */
  readonly target?: Automation["target"] | null
  /** `null` clears the standing session link; absent leaves it untouched. */
  readonly sessionTaskId?: string | null
}
