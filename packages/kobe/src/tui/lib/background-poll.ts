/**
 * Background poller for render paths needing subprocess data (git status,
 * HEAD, …) without blocking the event loop. Render processes must not run
 * synchronous subprocesses (docs/DESIGN.md §5.4,
 * `test/tui/render-path-sync-guard.test.ts`): a sync per-row `git status` on a
 * ~2s tick froze a 30GB repo for the whole status walk. Panes call `poll(key)`
 * fire-and-forget; `read(key)` is a cheap read.
 *
 * Per key (repo/worktree path) one value cell plus scheduling state, with
 * three guards on the child-process budget:
 *   - **in-flight dedupe**: one run per key; ticks during a run are dropped.
 *   - **adaptive cadence**: next run after `max(minIntervalMs, 5 × last
 *     duration)`, so slow repos thin out on their own.
 *   - **timeout + backoff**: past `timeoutMs` the run aborts (`spawnCapture`
 *     children are SIGKILLed) and the key backs off `slowRetryMs`.
 * The guards live in dependency-free `src/lib/poll-scheduling.ts`, shared with
 * the daemon's worktree-changes collector.
 *
 * Failure contract: a throw, abort, or late resolve never writes; `read` keeps
 * the last good value (or `initial`), so the UI goes stale, never errors.
 */

import { type PollScheduleState, maybeStartScheduledRun } from "../../lib/poll-scheduling.ts"

export {
  computeNextAllowedAt,
  shouldPoll,
  spawnCapture,
} from "../../lib/poll-scheduling.ts"

export interface BackgroundPollerConfig<T> {
  /** Pass the AbortSignal (fires at `timeoutMs`) to `spawnCapture` so a runaway child is SIGKILLed. Throw to keep the last value. */
  readonly run: (key: string, signal: AbortSignal) => Promise<T>
  readonly timeoutMs: number
  /** Backoff after a timeout. */
  readonly slowRetryMs: number
  /** Floor between successful runs, typically the caller's tick cadence. */
  readonly minIntervalMs: number
  /** An equal result isn't written back. Defaults to `===`. */
  readonly equals?: (a: T, b: T) => boolean
  /** `read` before the first run lands, and for empty keys. */
  readonly initial: T
}

export interface BackgroundPoller<T> {
  /** Never blocks. */
  read(key: string): T
  /**
   * Safe on every tick: extra calls are free, and a finishing run can't
   * re-trigger an immediate spawn (`minIntervalMs` floor).
   */
  poll(key: string): void
  /** Test hook. */
  reset(): void
}

interface PollEntry<T> extends PollScheduleState {
  read: () => T
  write: (next: T) => void
}

export function createBackgroundPoller<T>(cfg: BackgroundPollerConfig<T>): BackgroundPoller<T> {
  // DELIBERATELY no eviction: one small entry per distinct key ever seen, so
  // deleted worktrees linger; bounded by paths this process ever rendered
  // (hundreds ≈ tens of KB). Only `reset()` tears down.
  const entries = new Map<string, PollEntry<T>>()
  const equals = cfg.equals ?? ((a, b) => a === b)

  function entryFor(key: string): PollEntry<T> {
    let entry = entries.get(key)
    if (!entry) {
      let current = cfg.initial
      entry = {
        read: () => current,
        write: (next) => {
          if (!equals(current, next)) current = next
        },
        inFlight: false,
        nextAllowedAt: 0,
      }
      entries.set(key, entry)
    }
    return entry
  }

  return {
    read(key: string): T {
      if (!key) return cfg.initial
      return entryFor(key).read()
    },
    poll(key: string): void {
      if (!key) return
      const entry = entryFor(key)
      maybeStartScheduledRun(
        entry,
        cfg,
        (signal) => cfg.run(key, signal),
        (value) => entry.write(value),
      )
    },
    reset(): void {
      entries.clear()
    },
  }
}
