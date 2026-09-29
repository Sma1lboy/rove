/**
 * The `.activity` a caller reads off `collect` and `send`: the daemon's engine
 * state, plus the one failure it cannot see — an error the engine drew on
 * screen without reporting it (`engine-screen.ts`). Without that, a turn that
 * died before producing anything reads as `idle`, exactly like a finished one.
 */

import type { SerializedTask } from "@sma1lboy/kobe-daemon/daemon/protocol"
import type { DaemonRpc } from "../daemon-session.ts"
import { engineScreenError } from "./engine-screen.ts"

/** One row of the daemon's activity dump (`debug.inspect`). */
interface ActivityEntry {
  readonly state: string
  readonly at: number
  readonly detail?: { readonly failure?: string; readonly note?: string; readonly exit?: unknown }
}

export interface ActivityRegistry {
  readonly tasks: Record<string, ActivityEntry>
  readonly tabs: Record<string, Record<string, ActivityEntry>>
}

export interface ActivityView {
  readonly state: string
  readonly at: string
  /** Time in the CURRENT state; daemon/CLI clock skew clamps to 0. */
  readonly forMs: number
  readonly detail?: ActivityEntry["detail"]
  /** Set when the state came from the engine's screen, not the daemon. */
  readonly source?: "screen"
}

/** Every `.activity.state`, spelled out for `schema` (mirrors the daemon's `TaskActivityState`). */
export const ACTIVITY_STATES_DOC =
  "`.activity.state` is one of: `idle` (at rest), `running` (a turn is in progress), `turn_complete` (a turn finished — also at rest; treat it like idle when deciding whether the engine is free), `permission_needed` (blocked on an approval prompt), `rate_limited` (clears on its own), `error` (the last turn failed; `.activity.detail.note` carries the engine's text, and `.activity.source: \"screen\"` means it was read off the engine's own screen because the engine reported nothing), `dead` (the engine process exited; the tab's exit record says how)."

/**
 * States a screen error can override. At rest, any error at the bottom of the
 * screen explains the stop; `running` only when the error is the last thing
 * drawn — an engine with no failure hook (codex) never ends the claimed turn.
 */
const AT_REST = new Set(["idle", "turn_complete"])

/** One `debug.inspect` per call. `null` = couldn't ask, never an empty registry. */
export async function readActivityRegistry(daemon: DaemonRpc): Promise<ActivityRegistry | null> {
  try {
    const dbg = await daemon.request<{ activity?: Partial<ActivityRegistry> }>("debug.inspect")
    return { tasks: dbg?.activity?.tasks ?? {}, tabs: dbg?.activity?.tabs ?? {} }
  } catch {
    return null
  }
}

/**
 * A task's (or one tab's) activity, `null` when unknowable. An at-rest state
 * over a screen error becomes `error` with the error row as `detail.note`.
 */
export async function activityView(
  registry: ActivityRegistry | null,
  task: SerializedTask,
  tab?: string,
): Promise<ActivityView | null> {
  const entry = tab ? registry?.tabs[task.id]?.[tab] : registry?.tasks[task.id]
  if (!entry) return null
  const base = {
    state: entry.state,
    at: new Date(entry.at).toISOString(),
    forMs: Math.max(0, Date.now() - entry.at),
    ...(entry.detail ? { detail: entry.detail } : {}),
  }
  // The screen read looks at the canonical engine tab only.
  const atRest = AT_REST.has(entry.state)
  if (tab || !(atRest || entry.state === "running")) return base
  const note = await engineScreenError(task, { last: !atRest })
  return note ? { ...base, state: "error", detail: { failure: "other", note }, source: "screen" } : base
}
