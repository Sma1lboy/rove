/**
 * The activity registry's timer + async probe, apart from its synchronous
 * ledger writes. One policy for both scopes (tab-less entry, per-tab slot);
 * the caller supplies read and retire per scope.
 */

import {
  type ActivityLiveness,
  type ActivityLivenessProbe,
  type EngineSessionInfo,
  activityStillWorking,
} from "./activity-reduce.ts"

/**
 * CONSECUTIVE unknown probes that may re-arm before the claim retires anyway.
 * Unknown is absence of evidence: once the transcript is unreadable (worktree
 * deleted, session replaced, path moved) every probe says unknown, and
 * unbounded re-arming keeps the badge forever.
 *
 * Generous, since one unreadable probe is a transient FS error and idling a
 * mid-turn engine is worse; three in a row, a full TTL apart (30 min at the
 * default), isn't a hiccup. Retiring drops only the HOOK claim — the
 * observer's PTY evidence then decides — so being wrong costs one poll.
 */
export const MAX_UNKNOWN_REARMS = 3

/** Scope key: a task's tab-less entry, or one of its tabs. */
export interface LapseTarget {
  readonly taskId: string
  readonly tabId?: string
}

/** The subset of a hook entry the watchdog reads and writes. */
export interface LapseEntry {
  at: number
  vendor?: string
  session?: EngineSessionInfo
  lapse?: ReturnType<typeof setTimeout>
}

export interface LapseDeps {
  readonly staleMs: number
  readonly now: () => number
  readonly livenessAt: ActivityLivenessProbe
  /** The hook entry this scope polices, or `undefined` once it is gone. */
  readonly entryAt: (target: LapseTarget) => LapseEntry | undefined
  /** Drop the silent claim at this scope and publish what follows from it. */
  readonly retire: (target: LapseTarget) => void
}

export class ActivityLapseWatchdog {
  constructor(private readonly deps: LapseDeps) {}

  /**
   * (Re-)arm for the entry stamped `at`. A long turn emits nothing between
   * `turn-start` and `Stop`, so a fixed timer would idle a working agent. On
   * fire we probe the transcript: a write within `staleMs` re-arms (heartbeat);
   * only a silent engine (missed Stop / hung) lapses.
   */
  arm(target: LapseTarget, at: number, unknowns = 0): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      void this.fire(target, at, unknowns)
    }, this.deps.staleMs)
    timer.unref?.()
    return timer
  }

  /** Never crashes the daemon; a failed read of an identified session is unknown. */
  private async probe(taskId: string, vendor?: string, transcriptPath?: string): Promise<ActivityLiveness | undefined> {
    try {
      return await this.deps.livenessAt(taskId, vendor, transcriptPath)
    } catch {
      return transcriptPath ? { unknown: true } : undefined
    }
  }

  /**
   * Never throws. Any write before OR during the probe supersedes this lapse
   * (entry identity re-checked after the await). A rescheduled lapse is stored
   * on the live entry so a later event can cancel it.
   */
  private async fire(target: LapseTarget, at: number, unknowns = 0): Promise<void> {
    const before = this.deps.entryAt(target)
    if (!before || before.at !== at) return

    const live = await this.probe(target.taskId, before.vendor, before.session?.transcriptPath)

    // A stale entry would clobber newer state or resurrect a cleared task.
    const cur = this.deps.entryAt(target)
    if (cur !== before) return

    if (activityStillWorking(live, at, this.deps.now(), this.deps.staleMs)) {
      // Only unknowns count; a real recent write resets the streak, so a
      // healthy long turn re-arms indefinitely.
      const streak = live?.unknown === true ? unknowns + 1 : 0
      if (streak > MAX_UNKNOWN_REARMS) {
        this.deps.retire(target)
        return
      }
      cur.lapse = this.arm(target, at, streak)
      return
    }
    this.deps.retire(target)
  }
}
