/**
 * Async poller behind the sidebar's `+N −M` chip. Render paths must use this:
 * `git status` is O(repo size), and the sync `readWorktreeChanges` blocks the
 * event loop for seconds per tick on a huge repo (sync is CLI-only).
 *
 * Scheduling (per-key cell, in-flight dedupe, adaptive cadence, timeout + hard
 * backoff) is `src/tui/lib/background-poll.ts`; this binds it to one
 * `git status --porcelain=v1` per worktree. Failure/timeout keeps the LAST
 * value; never-read reads `null` = UNKNOWN, not zeros — EACCES `.git`, a walk
 * past POLL_TIMEOUT_MS (then SLOW_REPO_RETRY_MS off), git off PATH must not look
 * clean, since users check this chip before deleting a task. Deleted rows never
 * call `poll()`.
 *
 * NO-DAEMON FALLBACK only: when the daemon advertises `worktree.changes`, the
 * Sidebar renders its pushes and spawns zero git processes. The daemon's
 * collector (`kobe-daemon/daemon/worktree-changes-collector.ts`) shares the
 * guards via `src/lib/poll-scheduling.ts`.
 */

import { readOnlyGitProcessEnv } from "@/lib/git-env"
import { recordSpawn } from "@/lib/spawn-profile"
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
  /** Unknown until a poll lands — never zeros. */
  initial: null,
  // Same counts mustn't re-render every row each tick.
  equals: sameWorktreeChanges,
  timeoutMs: POLL_TIMEOUT_MS,
  slowRetryMs: SLOW_REPO_RETRY_MS,
  minIntervalMs: MIN_POLL_INTERVAL_MS,
  run: async (worktreePath, signal) => {
    // GIT_OPTIONAL_LOCKS=0 so the read never takes .git/index.lock from under
    // the engine's commits.
    recordSpawn("sidebar.worktreeChanges", ["git", "status", "--porcelain=v1"], worktreePath)
    const res = await spawnCapture("git", ["status", "--porcelain=v1"], {
      cwd: worktreePath,
      env: readOnlyGitProcessEnv(),
      signal,
    })
    if (res.status !== 0) throw new Error("git status failed")
    return parsePorcelain(res.stdout)
  },
})

/** Reactive last-known counts; `null` until a poll succeeds (unknown, not clean). */
export function worktreeChanges(worktreePath: string): WorktreeChanges | null {
  return poller.read(worktreePath)
}

/**
 * When the next poll may start. Timeouts back off hard; completed runs scale
 * with their own duration so slow repos self-thin. Exported for tests.
 */
export function nextAllowedAt(startedAt: number, finishedAt: number, timedOut: boolean): number {
  return computeNextAllowedAt(startedAt, finishedAt, timedOut, {
    slowRetryMs: SLOW_REPO_RETRY_MS,
    minIntervalMs: MIN_POLL_INTERVAL_MS,
  })
}

/**
 * Fire-and-forget; safe from a reactive memo every tick. The
 * MIN_POLL_INTERVAL_MS floor stops a finishing poll's signal update from
 * re-triggering an immediate spawn.
 */
export function pollWorktreeChanges(worktreePath: string): void {
  poller.poll(worktreePath)
}

/** Test hook: drop all cached entries/backoff state. */
export function resetWorktreeChangesPoller(): void {
  poller.reset()
}
