/**
 * Task-level activity rollup — DERIVED from the per-tab ledger, never stored:
 * a stored last-event-wins copy can't represent tabs A running and B complete
 * at once, and needs hand un-setting that leaves tasks pinned `running`.
 * Folds the tab entries plus the task's tab-less hook entry (an engine started
 * in a shell kobe didn't spawn reports no `KOBE_TAB_ID`).
 *
 * The order is by URGENCY, not recency:
 *   - any candidate `running` ⇒ running (newest such `at`). Work in ANY tab
 *     is work in the task; a completion elsewhere must not dim it.
 *   - else the newest STICKY state (`turn_complete` / `permission_needed` /
 *     `error` / `rate_limited` / `dead`) — "a human should look", which must
 *     survive a quiet sibling tab.
 *   - else idle (or `undefined` when no source has ever reported: unknown).
 */

import type { EffectiveActivity } from "./activity-arbitrate.ts"
import { type EngineSessionInfo, STICKY_STATES } from "./activity-reduce.ts"
import type { EngineActivityDetail, TaskActivityState } from "./contracts.ts"

/** One source's current claim about a task. Tab entries contribute their
 *  arbitrated `effective`; a tab-less hook entry contributes itself. */
export interface RollupCandidate {
  readonly state: TaskActivityState
  readonly at: number
  readonly detail?: EngineActivityDetail
  readonly vendor?: string
  readonly session?: EngineSessionInfo
  /** Winner's lapse watchdog, so `kobe api inspect` can report `lapseArmed`. */
  readonly lapse?: unknown
}

/** Urgency tiers: running outranks every attention state, which outrank idle. */
function urgency(state: TaskActivityState): number {
  if (state === "running") return 2
  return STICKY_STATES.has(state) ? 1 : 0
}

/** Highest urgency wins; newest `at` breaks ties. `undefined` when there are no candidates. */
export function deriveTaskActivity(candidates: Iterable<RollupCandidate>): RollupCandidate | undefined {
  let best: RollupCandidate | undefined
  let bestRank = -1
  for (const candidate of candidates) {
    const rank = urgency(candidate.state)
    if (rank > bestRank || (rank === bestRank && best !== undefined && candidate.at > best.at)) {
      best = candidate
      bestRank = rank
    }
  }
  return best
}

/** What {@link rollupCandidates} reads out of the per-tab ledger. */
export interface RollupTabEntry {
  readonly effective: EffectiveActivity
  readonly hook?: { readonly lapse?: unknown }
}

/** A task's tab-less entry plus each tab's arbitrated state; hook-sourced tabs carry their lapse handle. */
export function rollupCandidates(
  tabless: RollupCandidate | undefined,
  tabs: ReadonlyMap<string, RollupTabEntry> | undefined,
): RollupCandidate[] {
  const out: RollupCandidate[] = []
  if (tabless) out.push(tabless)
  if (tabs) {
    for (const entry of tabs.values()) {
      out.push({
        ...entry.effective,
        ...(entry.effective.source === "hook" && entry.hook?.lapse ? { lapse: entry.hook.lapse } : {}),
      })
    }
  }
  return out
}
