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
 *
 * Even once per TTL, the ladder is not free: 19 worktrees paid 75 `git`
 * processes (one `symbolic-ref` + three `rev-parse` each) every five
 * minutes. The candidates it probes are all plain branch names, so it reads
 * the ref FILES instead — loose refs, then `packed-refs` — and only falls
 * back to spawning when the worktree's git dirs are unreadable. A RECORDED
 * base ref keeps its `rev-parse` fallback: the user may have passed a tag or
 * a sha, which a ref-file read cannot disprove.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { DEFAULT_BASE_REF_CANDIDATES, readRefSha, resolveGitDirs } from "@sma1lboy/kobe-daemon/daemon/worktree-probe"
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

/**
 * The ladder read from ref files. Returns `undefined` — distinct from the
 * `null` that means "no base exists" — when the worktree's git dirs cannot
 * be resolved, which is the caller's signal to spawn `git` instead.
 *
 * `refs/remotes/origin/HEAD` is a symref file (`ref: refs/remotes/origin/x`)
 * or a `packed-refs` entry; both are read here rather than through
 * `git symbolic-ref`.
 */
function resolveLadderFromFiles(worktreePath: string): string | null | undefined {
  const dirs = resolveGitDirs(worktreePath)
  if (!dirs) return undefined
  const originHead = readRefSymbolic(dirs, "refs/remotes/origin/HEAD")
  if (originHead) return originHead.replace(/^refs\/remotes\//, "")
  for (const guess of DEFAULT_BASE_REF_CANDIDATES) if (readRefSha(dirs, guess) !== null) return guess
  return null
}

/** The ref a symref FILE points at (`ref: refs/…`), or null. */
function readRefSymbolic(dirs: ReturnType<typeof resolveGitDirs>, ref: string): string | null {
  if (!dirs) return null
  for (const dir of [dirs.gitDir, dirs.commonDir]) {
    try {
      const raw = readFileSync(join(dir, ref), "utf8").trim()
      const target = raw.match(/^ref:\s*(.+)$/)?.[1]?.trim()
      if (target) return target
    } catch {
      // Not present here — try the common dir, then give up.
    }
  }
  return null
}

async function resolveLadder(worktreePath: string, signal: AbortSignal): Promise<string | null> {
  const fromFiles = resolveLadderFromFiles(worktreePath)
  if (fromFiles !== undefined) return fromFiles
  const head = await spawnCapture("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], {
    cwd: worktreePath,
    env: readOnlyGitProcessEnv(),
    signal,
  })
  if (head.status === 0 && head.stdout.trim()) return head.stdout.trim()
  for (const guess of DEFAULT_BASE_REF_CANDIDATES) {
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
  // A recorded ref found in the ref files needs no spawn; NOT finding it
  // proves nothing (it could be a tag or a sha), so that falls back.
  if (recordedBaseRef) {
    const dirs = resolveGitDirs(worktreePath)
    if (dirs && readRefSha(dirs, recordedBaseRef) !== null) return recordedBaseRef
    if (await refExists(worktreePath, recordedBaseRef, signal)) return recordedBaseRef
  }
  const hit = cache.get(worktreePath)
  if (hit && now - hit.at < BASE_REF_TTL_MS) return hit.ref
  const ref = await resolveLadder(worktreePath, signal)
  cache.set(worktreePath, { ref, at: now })
  return ref
}
