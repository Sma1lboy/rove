/**
 * The activity lapse watchdog — the registry's only timer-and-probe concern,
 * split out on that seam: everything else in `activity-registry.ts` is a
 * synchronous ledger write, while this is a clock plus an async filesystem
 * read, and mixing the two is what made the ledger hard to read.
 *
 * ONE implementation covers both scopes it polices — a task's tab-less hook
 * entry and a per-tab hook slot. The policy is identical; the caller supplies
 * how to read the policed entry and what "retire it" means at that scope.
 */

import {
  type ActivityLiveness,
  type ActivityLivenessProbe,
  type EngineSessionInfo,
  activityStillWorking,
} from "./activity-reduce.ts"

/**
 * How many CONSECUTIVE "could not read it" probes may re-arm the watchdog
 * before it retires the claim anyway.
 *
 * An unknown probe is the ABSENCE of evidence, not evidence of work. Treating
 * it as "still working" unconditionally is the second way a `running` claim
 * outlives its engine: once the transcript stops being readable at all — the
 * worktree was deleted, the session was replaced, the path moved — every probe
 * from then on answers unknown, so the watchdog re-arms forever and the badge
 * never goes out.
 *
 * The bound has to be generous, because one unreadable probe really is a
 * transient filesystem error and idling a mid-turn engine over it is the worse
 * failure. Three in a row, each a full TTL apart (30 minutes at the default),
 * is not a hiccup.
 *
 * Retiring is not a verdict of "idle", either: it drops the HOOK claim and
 * lets the observer's own PTY evidence decide the tab, which is the source
 * that can still see it. So the cost of being wrong here is one poll, not a
 * wrong badge.
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
   * Arm (or re-arm) the watchdog for the entry stamped `at`. A long single
   * turn emits only `turn-start` … `Stop` over many minutes — nothing in
   * between — so a fixed timer would fire mid-turn and wrongly idle a working
   * agent. Bumping the TTL only moves that cliff. Instead, when the timer
   * fires we probe whether the engine is still writing its transcript: a write
   * within the trailing `staleMs` window ⇒ the turn is alive, so we re-arm (a
   * heartbeat) instead of retiring. Only a genuinely silent engine (no recent
   * write ⇒ a missed Stop / hung process) lapses.
   */
  arm(target: LapseTarget, at: number, unknowns = 0): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      void this.fire(target, at, unknowns)
    }, this.deps.staleMs)
    timer.unref?.()
    return timer
  }

  /** Probe wrapper: a best-effort filesystem read must never crash the daemon,
   *  and a failed read of an identified session stays unknown. */
  private async probe(taskId: string, vendor?: string, transcriptPath?: string): Promise<ActivityLiveness | undefined> {
    try {
      return await this.deps.livenessAt(taskId, vendor, transcriptPath)
    } catch {
      return transcriptPath ? { unknown: true } : undefined
    }
  }

  /**
   * Timer callback. Never throws. Guards against the entry changing across the
   * async probe: a `report()` / `clearTask()` / `close()` that runs before OR
   * during the probe supersedes this lapse (re-read the ledger and confirm the
   * same entry identity after the await). A rescheduled lapse is stored back
   * on the live entry, so a later event can cancel it.
   */
  private async fire(target: LapseTarget, at: number, unknowns = 0): Promise<void> {
    // Superseded before we even probed (a fresh report swapped the entry).
    const before = this.deps.entryAt(target)
    if (!before || before.at !== at) return

    const live = await this.probe(target.taskId, before.vendor, before.session?.transcriptPath)

    // Re-read after the await: the entry may have been replaced or cleared
    // while the probe was in flight. Acting on a stale `at` would clobber a
    // newer state or resurrect a cleared task.
    const cur = this.deps.entryAt(target)
    if (cur !== before) return

    if (activityStillWorking(live, at, this.deps.now(), this.deps.staleMs)) {
      // Count only the probes that said "I don't know". A probe that actually
      // read a recent write resets the streak, so a long turn on a healthy
      // transcript re-arms indefinitely exactly as before.
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
