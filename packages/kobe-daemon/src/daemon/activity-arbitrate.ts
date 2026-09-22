/**
 * Multi-source arbitration of one tab's activity. Each SOURCE writes only its
 * own slot:
 *
 *   - `hook`     — engine hook events (`report()`). Authoritative while the
 *                  engine lives (turn boundaries, permission prompts, rate
 *                  limits are invisible to PTY watching). A hook idle CLEARS
 *                  the slot; idle is never stored.
 *   - `observed` — the observer's PTY/foreground facts (`observeTab()`). Fills
 *                  the hooks' gaps (ESC interrupt, daemon restart, dead engine)
 *                  and marks KNOWN-idle, distinct from "no signal" (`◌`).
 *
 * `recomputeTabActivity` is the ONE place the priority order lives — add a
 * source as a slot + rule here, never by special-casing a writer:
 *
 *   0. an observed `running` newer than a hook `dead` wins — see rule 1.
 *   1. a hook in a STICKY state (`turn_complete` / `permission_needed` /
 *      `error` / `rate_limited` / `dead`) always wins: "a human should look",
 *      no output by nature, never dimmed by observation. A dead process can
 *      have no live claim, and an observed REST about it says nothing new (it
 *      would make a killed engine read idle). Rule 0 is its one escape: only a
 *      new engine can produce output after the death. Needed because a
 *      `NoopHookAdapter` engine never emits the session-start that would
 *      displace the slot, leaving `dead` for the daemon's life.
 *   2. a hook `running` wins UNLESS an observed `rest` is at least as fresh as
 *      the claim (a stale observation must never idle a fresh turn) AND the
 *      claim is ≥ `correctHookRunningAfterMs` old (PTY evidence trails the hook
 *      by one poll at a turn boundary) — then observation corrects it.
 *   3. any other hook entry wins.
 *   4. no hook → observed wins: `running` fills a restart's hole, `idle` is
 *      known-idle.
 *   5. neither → undefined: unknown, distinct from known-idle.
 *
 * Pure: the registry owns timers, bus and I/O.
 */

import { type EngineSessionInfo, STICKY_STATES } from "./activity-reduce.ts"
import type { EngineActivityDetail, TaskActivityState } from "./contracts.ts"

/** A hook-claimed state, never "idle". `dead` also lands here (via
 *  `recordEngineDeath`, not a hook) since it is a claim about the ENGINE. */
export interface HookSlot {
  readonly state: TaskActivityState
  readonly at: number
  readonly detail?: EngineActivityDetail
  readonly vendor?: string
  readonly session?: EngineSessionInfo
}

/** An observer-claimed fact — the PTY/foreground world only knows two. */
export interface ObservedSlot {
  readonly state: "running" | "idle"
  readonly at: number
  readonly vendor?: string
  /** Lineage from the corrected (and dropped) hook slot, kept for late
   *  subscribers and the liveness probe. */
  readonly session?: EngineSessionInfo
}

/** One tab's activity record: one slot per source. */
export interface TabActivitySlots {
  hook?: HookSlot
  observed?: ObservedSlot
}

/** The arbitrated result — what subscribers see. */
export interface EffectiveActivity {
  readonly state: TaskActivityState
  readonly at: number
  readonly source: "hook" | "observed"
  readonly detail?: EngineActivityDetail
  readonly vendor?: string
  readonly session?: EngineSessionInfo
}

function fromHook(hook: HookSlot): EffectiveActivity {
  return {
    state: hook.state,
    at: hook.at,
    source: "hook",
    ...(hook.detail ? { detail: hook.detail } : {}),
    ...(hook.vendor ? { vendor: hook.vendor } : {}),
    ...(hook.session ? { session: hook.session } : {}),
  }
}

function fromObserved(observed: ObservedSlot, hook?: HookSlot): EffectiveActivity {
  return {
    state: observed.state,
    at: observed.at,
    source: "observed",
    // Fall back to the corrected hook's lineage: consumers still need WHICH engine.
    ...((observed.vendor ?? hook?.vendor) ? { vendor: observed.vendor ?? hook?.vendor } : {}),
    ...((observed.session ?? hook?.session) ? { session: observed.session ?? hook?.session } : {}),
  }
}

/**
 * Effective state, or `undefined` if nothing ever reported ("unknown").
 * `correctHookRunningAfterMs` gates rule 2; the `Infinity` default never
 * corrects. The observer passes a value only on positive evidence (resting
 * title / dead session), never on a host-unreachable pass.
 */
export function recomputeTabActivity(
  slots: TabActivitySlots,
  now: number,
  correctHookRunningAfterMs: number = Number.POSITIVE_INFINITY,
): EffectiveActivity | undefined {
  const { hook, observed } = slots
  if (hook) {
    // Rule 0. A `NoopHookAdapter` engine (copilot) never clears `dead` via
    // session-start. Only an observed `running` AFTER the death may win: the
    // surviving shell walks as idle, which must not un-dim the badge, and the
    // observer claims `working` only for a walked engine, never a bare shell.
    if (hook.state === "dead" && observed?.state === "running" && observed.at > hook.at) {
      return fromObserved(observed, hook)
    }
    if (STICKY_STATES.has(hook.state)) return fromHook(hook)
    if (
      hook.state === "running" &&
      observed?.state === "idle" &&
      observed.at >= hook.at &&
      now - hook.at >= correctHookRunningAfterMs
    ) {
      return fromObserved(observed, hook)
    }
    return fromHook(hook)
  }
  if (observed) return fromObserved(observed)
  return undefined
}
