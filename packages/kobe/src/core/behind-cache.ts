/**
 * Behind-count memo for the daemon's per-worktree polls.
 *
 * `git rev-list --count HEAD..<base>` was half of the collector's process
 * budget — 570 of 1280 spawns in a 62-second idle measurement, 1:1 with the
 * `git status` walks — even though the answer can only move when HEAD moves
 * or the base ref moves. Both are ref files, so this keys the count on the
 * two SHAs read straight off disk (loose ref, else `packed-refs`) and skips
 * the spawn while they are unchanged.
 *
 * Fails safe in both directions: a sha that will not read (detached
 * odd states, an unreadable git dir, a ref this reader does not know how to
 * follow) is `null`, which never equals a cached value, so the count is
 * recomputed by `git` exactly as before — and a computed count is only
 * memoised when BOTH shas read cleanly, so nothing is ever served from a key
 * that was half-guessed.
 */

import { readHeadSha, readRefSha, resolveGitDirs } from "@sma1lboy/kobe-daemon/daemon/worktree-probe"

interface BehindEntry {
  readonly head: string
  readonly base: string
  readonly behind: number
}

const cache = new Map<string, BehindEntry>()

/** Test seam — the daemon keeps one process-wide cache. */
export function resetBehindCache(): void {
  cache.clear()
}

/** The `(HEAD, base)` sha pair, or null when either will not read. */
function readShas(worktreePath: string, baseRef: string): { head: string; base: string } | null {
  const dirs = resolveGitDirs(worktreePath)
  if (!dirs) return null
  const head = readHeadSha(dirs)
  const base = readRefSha(dirs, baseRef)
  return head && base ? { head, base } : null
}

/**
 * The behind-count for `worktreePath` vs `baseRef`, computed by `compute`
 * only when the ref shas say it could have changed. `compute` returns `null`
 * for an unusable answer (non-zero exit, unparseable) and that is passed
 * straight through without being cached.
 */
export async function behindCountCached(
  worktreePath: string,
  baseRef: string,
  compute: () => Promise<number | null>,
): Promise<number | null> {
  const shas = readShas(worktreePath, baseRef)
  const hit = shas ? cache.get(worktreePath) : undefined
  if (shas && hit && hit.head === shas.head && hit.base === shas.base) return hit.behind
  const behind = await compute()
  if (shas && behind !== null) cache.set(worktreePath, { ...shas, behind })
  return behind
}
