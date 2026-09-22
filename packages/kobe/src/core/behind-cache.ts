/**
 * Base-drift memo for the daemon's per-worktree polls. The `rev-list` count
 * was 570 of 1280 collector spawns in a 62s idle measurement, yet only moves
 * when HEAD or the base ref moves — so key it on both SHAs read off disk
 * (loose ref, else `packed-refs`). Ahead and behind share one key.
 *
 * Fails safe: an unreadable sha is `null`, which always recomputes via git,
 * and a result is cached only when BOTH shas read cleanly.
 */

import { readHeadSha, readRefSha, resolveGitDirs } from "@sma1lboy/kobe-daemon/daemon/worktree-probe"

interface DriftEntry {
  readonly head: string
  readonly base: string
  readonly value: unknown
}

const cache = new Map<string, DriftEntry>()

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
 * Runs `compute` only when the ref shas changed. A `null` result (non-zero
 * exit, unparseable) passes through uncached. Value type is the caller's.
 */
export async function driftCached<T>(
  worktreePath: string,
  baseRef: string,
  compute: () => Promise<T | null>,
): Promise<T | null> {
  const shas = readShas(worktreePath, baseRef)
  const hit = shas ? cache.get(worktreePath) : undefined
  if (shas && hit && hit.head === shas.head && hit.base === shas.base) return hit.value as T
  const value = await compute()
  if (shas && value !== null) cache.set(worktreePath, { ...shas, value })
  return value
}
