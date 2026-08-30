/**
 * `kobe api inspect`'s raw view of the activity registry — a pure projection,
 * split out of `activity-registry.ts` (file-size cap).
 *
 * Deliberately NOT the wire payload: a production bug report needs the fields
 * `engine-state` omits — the probe vendor, whether a lapse watchdog is armed,
 * and which SOURCE won the arbitration — because those are what distinguish
 * "the hook says running" from "we observed it running" when the two disagree.
 */

import type { EffectiveActivity } from "./activity-arbitrate.ts"
import type { EngineActivityDetail, TaskActivityState } from "./contracts.ts"

/** The task-rollup fields the dump reads (the registry owns the real shape). */
export interface DumpableEntry {
  readonly state: TaskActivityState
  readonly at: number
  readonly vendor?: string
  readonly detail?: EngineActivityDetail
  readonly lapse?: unknown
}

/** The per-tab record the dump reads: its arbitrated result + its hook slot. */
export interface DumpableTabEntry {
  readonly effective: EffectiveActivity
  readonly hook?: { readonly lapse?: unknown }
}

export interface ActivityDebugTask {
  readonly state: TaskActivityState
  readonly at: number
  readonly vendor?: string
  readonly lapseArmed: boolean
}

export interface ActivityDebugTab extends ActivityDebugTask {
  readonly observed?: true
  readonly source: "hook" | "observed"
  /** Present for a `dead` tab: how the engine process died. Without it an
   *  inspect dump said "dead" and nothing about why, which is the whole
   *  reason the exit record is worth carrying. */
  readonly exit?: EngineActivityDetail["exit"]
}

export interface ActivityDebugSnapshot {
  readonly tasks: Record<string, ActivityDebugTask>
  readonly tabs: Record<string, Record<string, ActivityDebugTab>>
}

export function buildActivityDebugSnapshot(
  activity: ReadonlyMap<string, DumpableEntry>,
  tabActivity: ReadonlyMap<string, ReadonlyMap<string, DumpableTabEntry>>,
): ActivityDebugSnapshot {
  const tasks: Record<string, ActivityDebugTask> = {}
  for (const [taskId, e] of activity) {
    tasks[taskId] = {
      state: e.state,
      at: e.at,
      ...(e.vendor ? { vendor: e.vendor } : {}),
      lapseArmed: e.lapse !== undefined,
    }
  }
  const tabs: Record<string, Record<string, ActivityDebugTab>> = {}
  for (const [taskId, tabMap] of tabActivity) {
    const out: Record<string, ActivityDebugTab> = {}
    for (const [tabId, e] of tabMap) {
      out[tabId] = {
        state: e.effective.state,
        at: e.effective.at,
        ...(e.effective.vendor ? { vendor: e.effective.vendor } : {}),
        ...(e.effective.source === "observed" ? { observed: true as const } : {}),
        ...(e.effective.detail?.exit ? { exit: e.effective.detail.exit } : {}),
        lapseArmed: e.hook?.lapse !== undefined,
        source: e.effective.source,
      }
    }
    tabs[taskId] = out
  }
  return { tasks, tabs }
}
