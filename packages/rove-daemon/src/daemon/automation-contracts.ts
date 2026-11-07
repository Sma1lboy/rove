/** Scheduled automations ("routines"): the schedule record, its run history, and the edit patch. */

import type { VendorId } from "./contracts.ts"
import type { DeliveryStatus } from "./delivery-contracts.ts"
import type { SkipVerdict } from "./runnability-contracts.ts"

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
  /** Absolute repo root; resolved once at create time. Absent = projectless:
   *  runs execute in `routineDir(id)` and their tasks are `noProject` dir tasks. */
  readonly repo?: string
  /** Delivered as the engine's launch-time first message. */
  readonly prompt: string
  readonly vendor?: VendorId
  /** Model each run's engine launches on, in the engine's own spelling (`Task.model`). */
  readonly model?: string
  /** Reasoning level each run's engine launches at (`Task.modelEffort`). */
  readonly modelEffort?: string
  /** Five-field cron, evaluated in the daemon host's local time. */
  readonly schedule: string
  readonly precheck?: AutomationPrecheck
  /** Script routine: run this command instead of an engine. `prompt` is empty,
   *  and non-empty stdout becomes the run's response. */
  readonly script?: AutomationPrecheck
  /** Hand each run's response, and runs that need a human, to a bound chat channel's agent (WeChat). */
  readonly notify?: boolean
  readonly baseRef?: string
  /**
   * Re-deliver into ONE standing task instead of a fresh worktree per firing.
   * Off by default and per-routine: a routine that EDITS code needs a clean,
   * landable branch, not a week of runs piled onto one.
   */
  readonly persistentSession?: boolean
  /** Exact user-owned conversation. Never creates or revives a task or tab. */
  readonly target?: { readonly kind: "existing-tab"; readonly taskId: string; readonly tabId: string }
  /** Webhook trigger: a POST to `/hooks/routines/<id>` signed with this secret
   *  (GitHub's `X-Hub-Signature-256`) fires one run, precheck included. */
  readonly webhook?: { readonly secret: string }
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
  /** Should-run refused the tick (`AutomationRun.blocked`): the task is busy, awaiting the owner, rate limited, … */
  | "skipped_blocked"
  | "skipped_missed"
  | "skipped_unavailable"
  | "dispatch_failed"
  /** A script routine's command exited 0. */
  | "ran"
  /** A script routine's command exited non-zero, timed out or could not start. */
  | "script_failed"

/**
 * Outcomes that repeat every firing until a human intervenes
 * (`skipped_precheck` and `skipped_blocked` must never alarm: the underlying
 * gate, report_missing or error episode is already in the Inbox). The one
 * definition the Inbox and the Routines list share, so they agree on which
 * routines are broken.
 */
export function automationRunNeedsAttention(status: AutomationRunStatus): boolean {
  return status === "dispatch_failed" || status === "skipped_unavailable" || status === "script_failed"
}

export interface AutomationPrecheckResult {
  readonly exitCode: number | null
  readonly timedOut: boolean
  readonly stdout: string
  readonly stderr: string
  readonly durationMs: number
}

/** `manual` (run-now) skips the precheck; `webhook` runs it, like `scheduled`. */
export type AutomationTrigger = "scheduled" | "manual" | "webhook"

export interface AutomationRun {
  readonly id: string
  readonly automationId: string
  /** Monotonic per automation; survives retention pruning. */
  readonly runNumber: number
  /** When this occurrence was SUPPOSED to run — not when it actually did. */
  readonly scheduledFor: string
  readonly status: AutomationRunStatus
  readonly trigger: AutomationTrigger
  /** What fired a `webhook` run, one line (`issues.opened Sma1lboy/rove#12 <url>`). */
  readonly event?: string
  readonly taskId?: string
  readonly tabId?: string
  readonly precheckResult?: AutomationPrecheckResult
  /** Why should-run refused this firing; set with `skipped_blocked`, and with `dispatch_failed` when it needs a human. */
  readonly blocked?: SkipVerdict
  readonly error?: string
  /** ISO-8601 event time. */
  readonly at: string
  /** The delivery armed for this run's prompt. Its report IS the run's
   *  response: `response` and `deliveryStatus` are read from it, never stored
   *  twice. */
  readonly deliveryId?: string
  /** What the agent reported for THIS run. Never inferred from a transcript:
   *  no report, no response. Projected from the linked delivery by
   *  `automation.runs`; stored only on runs that predate deliveries. */
  readonly response?: AutomationRunResponse
  /** Projected from the linked delivery, never stored. */
  readonly deliveryStatus?: DeliveryStatus
}

export interface AutomationRunResponse {
  readonly text: string
  /** ISO-8601 time the response was stored. */
  readonly at: string
}

/** Stored response cap, in characters. Over it the verb refuses rather than truncating. */
export const ROUTINE_RESPONSE_MAX_CHARS = 32_000

/** A delivered run with no response turns from awaiting to missing after this. */
export const ROUTINE_RESPONSE_WINDOW_MS = 2 * 60 * 60_000

/**
 * Where a run stands on its response. `null` for a run that never delivered a
 * prompt (nothing to respond to).
 */
export function routineRunResponseState(
  run: Pick<AutomationRun, "status" | "at" | "response" | "deliveryStatus">,
  nowMs: number,
): "responded" | "awaiting" | "missing" | null {
  if (run.response) return "responded"
  if (run.status !== "dispatched" && run.status !== "revived") return null
  // A delivery knows whether the turn ended unreported; the window is only
  // the fallback for runs that predate deliveries.
  if (run.deliveryStatus === "missing") return "missing"
  if (run.deliveryStatus === "awaiting") return "awaiting"
  return nowMs - Date.parse(run.at) > ROUTINE_RESPONSE_WINDOW_MS ? "missing" : "awaiting"
}

/** Mutable fields of an automation. `schedule` changes recompute `nextRunAt`. */
export interface AutomationPatch {
  readonly name?: string
  readonly prompt?: string
  readonly vendor?: VendorId | null
  readonly model?: string | null
  readonly modelEffort?: string | null
  readonly schedule?: string
  readonly precheck?: AutomationPrecheck | null
  readonly script?: AutomationPrecheck | null
  readonly notify?: boolean
  readonly baseRef?: string | null
  readonly enabled?: boolean
  readonly missedRunGraceMinutes?: number
  readonly persistentSession?: boolean
  /** Exact user-owned conversation. Never creates or revives a task or tab. */
  readonly target?: Automation["target"] | null
  /** `null` turns the webhook trigger off. */
  readonly webhook?: Automation["webhook"] | null
  /** `null` clears the standing session link; absent leaves it untouched. */
  readonly sessionTaskId?: string | null
}
