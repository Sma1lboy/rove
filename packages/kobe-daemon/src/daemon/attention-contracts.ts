/**
 * Engine ACTIVITY and the attention Inbox — what an engine is doing, and what
 * is waiting for a person.
 *
 * Their own module for the reason `automation-contracts.ts` has one: this is a
 * self-contained group with its own store (`attention-inbox.ts`), its own RPC
 * family and its own channel, and nothing else in `contracts.ts` refers to it.
 * Re-exported from `contracts.ts` so every existing importer keeps naming them
 * there.
 */

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
   * For the `dead` state: how the engine process died, straight off the
   * pty-host's exit record. `code`/`signal` answer "who killed it" (143 =
   * 128+SIGTERM, an outside signal, not a self-exit) and `lastLine` is the
   * last non-blank line of the recorded tail — the 403 / auth / quota text
   * that sits on disk with nothing else surfacing it.
   */
  readonly exit?: {
    readonly code?: number | null
    readonly signal?: string | null
    readonly lastLine?: string
  }
  /**
   * The routine behind a `routine_failed` episode. A schedule is the one thing
   * in Rove that acts with nobody watching, so when its firing needs a human
   * the Inbox is where that has to land — and the episode's subject is the
   * ROUTINE, which is why it is named here rather than inferred from a task.
   * `status` is an {@link AutomationRunStatus}; `error` is the run record's own
   * reason, copied because the Inbox row has to be readable on its own.
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
   * The engine PROCESS died — an exit record exists for the tab's session
   * (`pty-exits.json`). Distinct from `error`: `error` is an engine that ran
   * and reported a failed turn, `dead` is an engine that is gone.
   * A killed engine fires no hook at all, so this state can only ever be
   * written from the exit record, never from `reduceActivity`.
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
  /** The engine PROCESS died (pty-host exit record). An episode a user must
   *  see: nothing else in the queue tells them the agent is simply gone. */
  "dead",
  /** A routine's latest firing needs a human (see
   *  {@link automationRunNeedsAttention}). The only episode whose subject is
   *  not a task: a routine pointed at a repo that moved never creates one, so
   *  requiring a task would mean the failure that repeats every minute
   *  forever is the one failure the Inbox cannot show. */
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
  // A routine episode is keyed on its ROUTINE, which is what makes the dedupe
  // right: a fresh-task routine mints a new task every firing, so keying on
  // the task would file 1,440 episodes a day for one broken schedule.
  if (item.state === "routine_failed" && item.detail?.routine)
    return `\u0000routine\u0000${item.detail.routine.automationId}`
  // Every other episode DESCRIBES the engine, so one-per-tab is right: a
  // fresh turn-complete should replace the stale one.
  return `${item.taskId}\0${item.tabId ?? ""}`
}

/** One daemon-owned, durable attention episode for a task's engine tab. */
export interface AttentionInboxItem {
  /**
   * `null` only for a `routine_failed` episode, whose subject is a schedule
   * and which may have produced no task at all.
   *
   * A routine episode MAY still name a task: a firing that created one and
   * then failed to start its engine carries that id, because
   * `automation-dispatch.ts` keeps it as the only handle a human has on the
   * half-built task. Its SUBJECT is the routine either way — which is why
   * every reader keys, filters, opens and reaches a routine episode by the
   * routine (`attentionInboxItemKey`, `isAttentionInboxItemAvailable`,
   * `nextAttentionInboxTarget`, the Inbox pane's open action) and never by
   * the task. A reader that demands `null` here rejects the episode the
   * daemon actually produces.
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
