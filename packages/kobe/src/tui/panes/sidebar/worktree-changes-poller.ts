/**
 * Async, self-throttling poller behind the sidebar's per-row `+N −M`
 * worktree-changes chip.
 *
 * Why this exists: `git status` walks the working tree — O(repo size) —
 * so calling the synchronous `readWorktreeChanges` (`spawnSync git
 * status`) from a render path blocks the whole event loop for seconds
 * per tick on a huge repo. The sync helper survives ONLY for one-shot
 * CLI use (`kobe api`); render paths must go through this poller.
 *
 * The scheduling core (per-key value cell, in-flight dedupe, adaptive
 * cadence, timeout + hard backoff) is the generic
 * `src/tui/lib/background-poll.ts` — this module is the worktree-changes
 * binding: one async `git status --porcelain=v1` per worktree, parsed
 * into `+N −M` counts. Failure / timeout keeps the LAST value; a worktree
 * that has never read cleanly reads `null`, which the row renders as
 * UNKNOWN. Deliberately not zeros: an EACCES `.git`, a repo whose status
 * walk blows POLL_TIMEOUT_MS (then sits out SLOW_REPO_RETRY_MS), and git
 * off PATH would otherwise all be indistinguishable from a clean worktree
 * — and this chip is what a user checks before deleting a task.
 *
 * Deleted rows never call `poll()` at all (the Sidebar shows only live
 * tasks): a deleted task must not pay git-status for worktrees that no
 * longer matter.
 *
 * This poller is the NO-DAEMON FALLBACK only: when a
 * connected daemon advertises the `worktree.changes` channel (one
 * collector in the daemon, pushed counts), the Sidebar renders the pushes
 * and never calls `poll()` here — a pane spawns zero git processes while
 * daemon-connected. The daemon's collector
 * (`kobe-daemon/daemon/worktree-changes-collector.ts`) reuses the same
 * scheduling guards via `src/lib/poll-scheduling.ts`.
 */

import { readOnlyGitProcessEnv } from "@/lib/git-env"
import { computeNextAllowedAt, createBackgroundPoller, spawnCapture } from "../../lib/background-poll"
import { type WorktreeChanges, parsePorcelain, sameWorktreeChanges } from "./worktree-changes"

export { shouldPoll } from "../../lib/background-poll"

/** Kill a git status that runs longer than this; the repo is too big to poll. */
export const POLL_TIMEOUT_MS = 4_000
/** After a timeout, leave the worktree alone for this long before retrying. */
export const SLOW_REPO_RETRY_MS = 60_000
/** Floor between successful polls — matches the sidebar's ~2s tick. */
export const MIN_POLL_INTERVAL_MS = 1_500

const poller = createBackgroundPoller<WorktreeChanges | null>({
  /** Unknown until a poll lands — see the header: never zeros. */
  initial: null,
  // Value-equality so a poll returning the same counts doesn't
  // re-render every visible row each tick.
  equals: sameWorktreeChanges,
  timeoutMs: POLL_TIMEOUT_MS,
  slowRetryMs: SLOW_REPO_RETRY_MS,
  minIntervalMs: MIN_POLL_INTERVAL_MS,
  run: async (worktreePath, signal) => {
    // Same flags + lock policy as the sync helper: porcelain v1, and
    // GIT_OPTIONAL_LOCKS=0 so the read never takes .git/index.lock from
    // under the engine's own commits.
    const res = await spawnCapture("git", ["status", "--porcelain=v1"], {
      cwd: worktreePath,
      env: readOnlyGitProcessEnv(),
      signal,
    })
    if (res.status !== 0) throw new Error("git status failed")
    return parsePorcelain(res.stdout)
  },
})

/**
 * Reactive read of the last known change counts for `worktreePath`.
 * `null` until a poll has completed successfully — the row renders that as
 * unknown, not as clean.
 */
export function worktreeChanges(worktreePath: string): WorktreeChanges | null {
  return poller.read(worktreePath)
}

/**
 * When the next poll may start. Pure — exported for unit tests.
 * Timed-out runs back off hard; completed runs scale with their own
 * duration so slow repos self-thin without a special case.
 */
export function nextAllowedAt(startedAt: number, finishedAt: number, timedOut: boolean): number {
  return computeNextAllowedAt(startedAt, finishedAt, timedOut, {
    slowRetryMs: SLOW_REPO_RETRY_MS,
    minIntervalMs: MIN_POLL_INTERVAL_MS,
  })
}

/**
 * Fire-and-forget: maybe start an async `git status` for `worktreePath`.
 * Safe to call from a reactive memo on every tick — the guards make the
 * extra calls free, and a signal update caused by a finishing poll
 * cannot re-trigger an immediate spawn (MIN_POLL_INTERVAL_MS floor).
 *
 */
export function pollWorktreeChanges(worktreePath: string): void {
  poller.poll(worktreePath)
}

/** Test hook: drop all cached entries/backoff state. */
export function resetWorktreeChangesPoller(): void {
  poller.reset()
}
