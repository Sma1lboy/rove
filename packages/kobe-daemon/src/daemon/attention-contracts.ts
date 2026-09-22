/** Engine ACTIVITY and the attention Inbox: what an engine is doing, and what
 *  is waiting for a person. Re-exported from `contracts.ts`. */

export type EngineActivityKind =
  | "session-start"
  | "turn-start"
  | "turn-complete"
  | "turn-failed"
  | "turn-interrupted"
  | "awaiting-input"
  | "session-end"
  // Lifecycle-only kinds — plugin-facing, never folded into the activity badge.
  | "tool-pre"
  | "tool-post"
  | "tool-failed"
  | "pre-compact"
  | "post-compact"
  | "subagent-start"
  | "subagent-stop"

export interface EngineActivityDetail {
  readonly failure?: "rate_limit" | "billing" | "other"
  readonly waiting?: "permission" | "input"
  readonly tool?: { readonly name?: string; readonly id?: string }
  readonly compact?: { readonly trigger?: "manual" | "auto" }
  readonly subagent?: { readonly type?: string; readonly id?: string }
  readonly note?: string
  /**
   * For `dead`: the pty-host's exit record. `code`/`signal` say who killed it
   * (143 = 128+SIGTERM, an outside signal); `lastLine` is the tail's last
   * non-blank line (the 403 / auth / quota text nothing else surfaces).
   */
  readonly exit?: {
    readonly code?: number | null
    readonly signal?: string | null
    readonly lastLine?: string
  }
  /**
   * The routine behind a `routine_failed` episode, named here because the
   * subject is the ROUTINE, not a task. `status` is an
   * {@link AutomationRunStatus}; `error` is copied from the run record so the
   * Inbox row reads on its own.
   */
  readonly routine?: {
    readonly automationId: string
    readonly name: string
    readonly status: string
    readonly error?: string
  }
}

export type TaskActivityState =
  | "idle"
  | "running"
  | "turn_complete"
  | "rate_limited"
  | "permission_needed"
  | "error"
  /**
   * The engine PROCESS died (`pty-exits.json` has a record); `error` is a
   * failed turn from a live engine. A killed engine fires no hook, so this is
   * written only from the exit record, never from `reduceActivity`.
   */
  | "dead"

/** States represented by pending Inbox items until handled or the same
 * Terminal Tab starts another turn. Deliberately NOT a subset of
 * {@link TaskActivityState}: `routine_failed` is a schedule's state, not an
 * engine's. */
export const ATTENTION_INBOX_STATES = [
  "turn_complete",
  "permission_needed",
  "error",
  "rate_limited",
  /** The engine PROCESS died; nothing else tells the user the agent is gone. */
  "dead",
  /** A routine's latest firing needs a human ({@link automationRunNeedsAttention}).
   *  The only episode whose subject isn't a task: a routine on a moved repo
   *  never creates one. */
  "routine_failed",
] as const

export type AttentionInboxState = (typeof ATTENTION_INBOX_STATES)[number]

export function isAttentionInboxState(value: unknown): value is AttentionInboxState {
  return typeof value === "string" && (ATTENTION_INBOX_STATES as readonly string[]).includes(value)
}

export function attentionInboxItemKey(item: {
  taskId: string | null
  tabId: string | null
  state?: AttentionInboxState
  detail?: EngineActivityDetail
}): string {
  // Keyed on the ROUTINE: a fresh-task routine mints a task per firing, so a
  // task key would file 1,440 episodes a day for one broken per-minute schedule.
  if (item.state === "routine_failed" && item.detail?.routine)
    return `\u0000routine\u0000${item.detail.routine.automationId}`
  // Engine episodes: one per tab, the fresh one replacing the stale.
  return `${item.taskId}\0${item.tabId ?? ""}`
}

/** One daemon-owned, durable attention episode for a task's engine tab. */
export interface AttentionInboxItem {
  /**
   * `null` only for a `routine_failed` episode that produced no task. A
   * routine episode MAY name a half-built task (created, engine failed to
   * start), but its SUBJECT is the routine: readers key, filter and open it
   * by routine, and must not demand `null` here.
   */
  readonly taskId: string | null
  /** `null` for hook events that predate or lack a tab identity. */
  readonly tabId: string | null
  readonly state: AttentionInboxState
  readonly detail?: EngineActivityDetail
  /** Compatibility field ignored by the queue model; new episodes set it to `true`. */
  readonly unread: boolean
  /** Event time, epoch milliseconds. Stable across daemon/TUI restarts. */
  readonly at: number
}
