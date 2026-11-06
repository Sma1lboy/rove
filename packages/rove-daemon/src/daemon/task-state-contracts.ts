/** The durable per-task state records the daemon keeps and mirrors from rove/types/task.ts. */

export interface TaskDeletionState {
  readonly phase: "queued" | "running" | "error"
  readonly force: boolean
  /** Opt-in: also delete the task's git branch. Default (absent/false) keeps
   *  the branch — git history is the durable record, the task row is not. */
  readonly deleteBranch?: boolean
  readonly requestedAt: string
  readonly error?: string
}

/** A one-shot delayed start of an unstarted task (mirrors rove/types/task.ts). */
export interface TaskScheduledStart {
  /** ISO-8601 time the engine starts. */
  readonly at: string
  /** The first message the engine starts with; an unstarted task stores none of its own. */
  readonly prompt: string
}

/** Durable rate-limit auto-resume schedule (mirrors rove/types/task.ts). */
export interface TaskQuotaResumeState {
  /** ISO-8601 time the provider's exhausted quota window resets. */
  readonly resumeAt: string
  /** ISO-8601 time the rate limit was observed and this schedule written. */
  readonly requestedAt: string
}

/**
 * A worker's own outcome claim (mirrors rove/types/task.ts).
 *
 * Kept apart from {@link TaskPRStatus} on purpose: this is what the worker
 * SAID, that is what the daemon OBSERVED by polling the forge. A dispatcher
 * deciding whether to land needs to know which of the two it is holding.
 */
export interface TaskWorkerReport {
  readonly branch?: string
  readonly pr?: number
  readonly summary?: string
  /** ISO-8601 time the report was written. */
  readonly at: string
}
