/**
 * Engine-neutral activity-event vocabulary (+ the reducer, re-exported).
 *
 * kobe learns what a task's engine is doing from engine HOOKS (e.g. Claude
 * Code's Stop / StopFailure / Notification / Session*, Codex's hooks.json).
 * Each {@link EngineHookAdapter} maps its vendor hook to a NORMALIZED verb and
 * shells out to `kobe hook <verb>`; everything downstream speaks only this
 * vocabulary, so no vendor strings leak past the adapter (CLAUDE.md
 * "Engine-owned UI data").
 *
 * Pure (no I/O). {@link reduceActivity} lives in the daemon package, re-exported below.
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
  /** The engine PROCESS is gone (pty-host exit record) — see the daemon's
   *  `TaskActivityState`. Never produced by `reduceActivity`: a killed engine
   *  fires no hook. */
  "dead",
] as const satisfies readonly DaemonTaskActivityState[]
/**
 * Re-exported from the daemon, which OWNS this vocabulary (kobe depends on
 * kobe-daemon, never the reverse). `satisfies` rejects a member the daemon
 * lacks and the assignment below rejects one the list above is missing, so
 * they cannot drift.
 */
export type TaskActivityState = DaemonTaskActivityState
const _everyStateListed: readonly (typeof TASK_ACTIVITY_STATES)[number][] = [] as readonly TaskActivityState[]
void _everyStateListed

/**
 * The activity state machine, defined ONCE in the daemon package (its only
 * production caller is `DaemonActivityRegistry`) and re-exported here.
 * @see {@link import("@sma1lboy/kobe-daemon/daemon/activity-reduce").reduceActivity}
 */
export { reduceActivity } from "@sma1lboy/kobe-daemon/daemon/activity-reduce"
import type { TaskActivityState as DaemonTaskActivityState } from "@sma1lboy/kobe-daemon/daemon/contracts"
