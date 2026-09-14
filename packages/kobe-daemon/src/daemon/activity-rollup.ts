/**
 * Task-level activity rollup — DERIVED from the per-tab ledger, never stored.
 *
 * The registry used to keep a second, hand-maintained copy of the task state
 * next to the per-tab records, updated last-event-wins across every tab. That
 * shape cannot be right for a multi-tab task: tab A's `turn-start` and tab B's
 * `turn-complete` are both true at once, and whichever landed last decided
 * what the sidebar showed. It also had to be un-set by hand from three other
 * places (engine death, an observer idle correction, the lapse watchdog),
 * each with its own "was this MY entry?" ownership test — so a tab that died
 * or went quiet without being the last writer left the task pinned `running`
 * with no live tab under it.
 *
 * So: no second copy. One function folds the tab entries (plus the task's
 * tab-less hook entry — an engine the user started in a shell kobe did not
 * spawn reports with no `KOBE_TAB_ID`) into the state the task row shows.
 *
 * The order is by URGENCY, not recency:
 *   - any candidate `running` ⇒ running (newest such `at`). Work in ANY tab
 *     is work in the task; a completion elsewhere must not dim it.
 *   - else the newest STICKY state (`turn_complete` / `permission_needed` /
 *     `error` / `rate_limited` / `dead`) — the states that mean "a human
 *     should look", which must survive a quiet sibling tab.
 *   - else idle (or `undefined` when no source has ever reported: unknown).
 *
 * Pure: no timers, no bus, no I/O — the registry owns those.
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
  /** The winner's lapse watchdog, when it has one — carried so `kobe api
   *  inspect` can still report `lapseArmed` for the derived rollup. */
  readonly lapse?: unknown
}

/** Urgency tiers: running outranks every attention state, which outrank idle. */
function urgency(state: TaskActivityState): number {
  if (state === "running") return 2
  return STICKY_STATES.has(state) ? 1 : 0
}

/**
 * Fold every source's claim into the one the task row shows, or `undefined`
 * when there is nothing to show. Highest urgency wins; newest `at` breaks a
 * tie within a tier.
 */
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

/**
 * Every candidate for one task: its tab-less hook entry plus each tab's
 * arbitrated state. A hook-sourced tab carries its lapse handle along so
 * `kobe api inspect` can still say whether the WINNING claim is policed.
 */
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
