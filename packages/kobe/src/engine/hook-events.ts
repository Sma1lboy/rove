/**
 * Engine-neutral activity-event vocabulary (+ the reducer, re-exported).
 *
 * kobe learns "what is this task's engine doing right now" from engine HOOKS
 * (Claude Code's Stop / StopFailure / Notification / Session*; Codex's
 * hooks.json equivalents later). Each engine's {@link EngineHookAdapter}
 * translates its vendor-specific hook into one of these NORMALIZED verbs and
 * shells out to `kobe hook <verb>` (cwd-based; the daemon maps it to a task).
 * Everything downstream —
 * the `kobe hook` CLI, the daemon, the TUI — speaks only this neutral
 * vocabulary, so no vendor strings leak past the adapter (CLAUDE.md
 * "Engine-owned UI data").
 *
 * This module is pure (no I/O). The state machine itself ({@link
 * reduceActivity}) is defined in the daemon package and re-exported below.
 */

/** The normalized hook verbs a `kobe hook <verb>` invocation carries. */
export const ENGINE_ACTIVITY_KINDS = [
  "session-start",
  "turn-start",
  "turn-complete",
  "turn-failed",
  "turn-interrupted",
  "awaiting-input",
  "session-end",
  // Lifecycle-only verbs (docs/design/plugin-events.md): forwarded to plugin
  // event hooks but NOT folded into the activity badge state.
  "tool-pre",
  "tool-post",
  "tool-failed",
  "pre-compact",
  "post-compact",
  "subagent-start",
  "subagent-stop",
] as const
export type EngineActivityKind = (typeof ENGINE_ACTIVITY_KINDS)[number]

export function isEngineActivityKind(v: string): v is EngineActivityKind {
  return (ENGINE_ACTIVITY_KINDS as readonly string[]).includes(v)
}

/** The subset that changes the task's activity STATE (badge + inbox). The
 *  rest are lifecycle observations plugins subscribe to; publishing them as
 *  engine-state would spam every client on every tool call. */
export const ACTIVITY_STATE_KINDS = [
  "session-start",
  "turn-start",
  "turn-complete",
  "turn-failed",
  "turn-interrupted",
  "awaiting-input",
  "session-end",
] as const satisfies readonly EngineActivityKind[]

export function affectsActivityState(kind: string): boolean {
  return (ACTIVITY_STATE_KINDS as readonly string[]).includes(kind)
}

/** Optional normalized detail an adapter can attach (read from the hook's stdin payload). */
export interface EngineActivityDetail {
  /** For `turn-failed`: a normalized failure class. */
  readonly failure?: "rate_limit" | "billing" | "other"
  /** For `awaiting-input`: why the engine is blocked. */
  readonly waiting?: "permission" | "input"
  /** For `tool-*`: normalized tool identity (vendor field spellings die here). */
  readonly tool?: { readonly name?: string; readonly id?: string }
  /** For `pre-compact`/`post-compact`: what triggered the compaction. */
  readonly compact?: { readonly trigger?: "manual" | "auto" }
  /** For `subagent-*`: which nested agent. */
  readonly subagent?: { readonly type?: string; readonly id?: string }
  /** Free-form human note (e.g. the raw error type), shown in tooltips. */
  readonly note?: string
}

/**
 * The per-task activity state the daemon publishes and the sidebar renders.
 * Distinct from the lifecycle {@link import("../types/task").TaskStatus}
 * (which is user-driven): this is transient, engine-driven liveness.
 */
export const TASK_ACTIVITY_STATES = [
  "idle",
  "running",
  "turn_complete",
  "rate_limited",
  "permission_needed",
  "error",
] as const
export type TaskActivityState = (typeof TASK_ACTIVITY_STATES)[number]

/**
 * The activity state machine. Defined ONCE, in the daemon package — the
 * daemon is the only production caller (`DaemonActivityRegistry`), and kobe
 * depends on kobe-daemon (never the reverse), so this side re-exports.
 * A second copy lived here and drifted; a fix now lands in one place.
 * @see {@link import("@sma1lboy/kobe-daemon/daemon/activity-reduce").reduceActivity}
 */
export { reduceActivity } from "@sma1lboy/kobe-daemon/daemon/activity-reduce"
