/**
 * Async, cached base-ref resolution for the daemon's per-worktree polls.
 *
 * `cli/api/branch-signals.ts` owns the ladder itself (`origin/HEAD` →
 * `origin/main` → `origin/master` → `main` → `master`) but resolves it with
 * `spawnSync`, which is correct for a one-shot CLI read and wrong on the
 * daemon's 2-second tick: up to five synchronous `git rev-parse` calls per
 * worktree per tick would block the daemon's event loop for every other
 * client. So this is the same ladder, spawned asynchronously and MEMOISED —
 * a worktree's base ref does not move between ticks.
 *
 * The cache has a TTL rather than being permanent: a repo that gains an
 * `origin` remote, or whose base branch is renamed, has to be able to start
 * reporting drift without a daemon restart. A negative answer (no base
 * resolves at all) is cached too, for the same TTL — otherwise a repo with no
 * remote pays the full five-probe ladder every tick forever.
 */

import { readOnlyGitProcessEnv } from "../lib/git-env.ts"
import { spawnCapture } from "../lib/poll-scheduling.ts"

/** How long a resolution (including "none") is trusted. */
export const BASE_REF_TTL_MS = 5 * 60_000

const cache = new Map<string, { readonly ref: string | null; readonly at: number }>()

/** Test seam — the daemon keeps one process-wide cache. */
export function resetBaseRefCache(): void {
  cache.clear()
}

async function refExists(worktreePath: string, ref: string, signal: AbortSignal): Promise<boolean> {
  const out = await spawnCapture("git", ["rev-parse", "--verify", "--quiet", ref], {
    cwd: worktreePath,
    env: readOnlyGitProcessEnv(),
    signal,
  })
  return out.status === 0
}

async function resolveLadder(worktreePath: string, signal: AbortSignal): Promise<string | null> {
  const head = await spawnCapture("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], {
    cwd: worktreePath,
    env: readOnlyGitProcessEnv(),
    signal,
  })
  if (head.status === 0 && head.stdout.trim()) return head.stdout.trim()
  for (const guess of ["origin/main", "origin/master", "main", "master"]) {
    if (await refExists(worktreePath, guess, signal)) return guess
  }
  return null
}

/**
 * The base to measure this worktree against: the task's RECORDED fork point
 * when it still resolves, else the cached ladder. `null` when nothing
 * resolves — callers then report no drift rather than a fabricated zero.
 *
 * A recorded ref is verified but NOT cached: it is per-task, cheap (one
 * `rev-parse`), and caching it under the worktree path would be wrong for a
 * path two tasks share.
 */
export async function resolveBaseRefCached(
  worktreePath: string,
  recordedBaseRef: string | undefined,
  signal: AbortSignal,
  now: number = Date.now(),
): Promise<string | null> {
  if (recordedBaseRef && (await refExists(worktreePath, recordedBaseRef, signal))) return recordedBaseRef
  const hit = cache.get(worktreePath)
  if (hit && now - hit.at < BASE_REF_TTL_MS) return hit.ref
  const ref = await resolveLadder(worktreePath, signal)
  cache.set(worktreePath, { ref, at: now })
  return ref
}
