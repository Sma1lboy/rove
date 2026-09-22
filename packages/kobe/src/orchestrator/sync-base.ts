/**
 * Merge the base branch INTO a task's worktree mid-work (the `↓N` drift chip);
 * the inverse of `land.ts`.
 *
 * MERGE, never rebase: a live engine may hold files mid-edit. A conflicted
 * merge is undoable with `git merge --abort`; a rebase interrupted mid-turn
 * leaves a detached HEAD partway through a replay.
 *
 * A conflict is a NORMAL outcome, returned as a typed `SYNC_CONFLICT: <files>`
 * message (like `LAND_CONFLICT`). Unlike landing, the merge is left IN PLACE —
 * aborting would discard the resolution the user is about to do.
 */

import { readOnlyGitProcessEnv } from "../lib/git-env.ts"
import { spawnCapture } from "../lib/poll-scheduling.ts"
import { parseDirtyPaths } from "./dirty-paths.ts"

/** `git merge` can stall on a hook or a huge tree; kill it rather than hang. */
export const SYNC_TIMEOUT_MS = 60_000

export interface SyncBaseResult {
  /** The ref merged in. */
  readonly baseRef: string
  /** True when the merge changed nothing — the worktree was already current. */
  readonly alreadyCurrent: boolean
}

/** Marker the TUI matches on, the same shape `land.ts` uses for LAND_CONFLICT. */
export const SYNC_CONFLICT = "SYNC_CONFLICT"
/** Marker for "the worktree has uncommitted changes git would clobber". */
export const SYNC_DIRTY = "SYNC_WORKTREE_DIRTY"

async function git(cwd: string, args: readonly string[], signal: AbortSignal, write = false) {
  return spawnCapture("git", args, { cwd, env: write ? process.env : readOnlyGitProcessEnv(), signal })
}

/**
 * Conflicted paths from `git diff --name-only --diff-filter=U`. Empty means
 * the merge failed for another reason — not a conflict.
 */
export function parseConflictedPaths(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/**
 * Merge `baseRef` into the worktree's current branch. Throws with a
 * `SYNC_CONFLICT: a, b, c` / `SYNC_WORKTREE_DIRTY: a, b, c` message on the two
 * outcomes a human can act on, and git's own stderr on anything else.
 */
export async function syncWorktreeWithBase(
  worktreePath: string,
  baseRef: string,
  signal: AbortSignal,
): Promise<SyncBaseResult> {
  // Refuse a dirty worktree BEFORE touching anything; `git merge` would refuse
  // with text that has no conflicted-file list. UNTRACKED COUNTS: an untracked
  // file the base also adds otherwise falls through to a bare "git merge
  // failed". Same flags as landing's `isDirty`.
  const status = await git(worktreePath, ["status", "--porcelain=v1"], signal)
  if (status.status !== 0) throw new Error("git status failed")
  const dirty = parseDirtyPaths(status.stdout)
  // Named, since the change may be one untracked file the user doesn't know
  // about. The remedy is COMMIT, not stash: the stash stack is shared by every
  // linked worktree, so a parallel task can pop or drop it.
  if (dirty.length > 0) throw new Error(`${SYNC_DIRTY}: ${dirty.join(", ")}`)

  const before = await git(worktreePath, ["rev-parse", "HEAD"], signal)
  const merge = await git(worktreePath, ["merge", "--no-edit", baseRef], signal, true)
  if (merge.status !== 0) {
    const conflicted = await git(worktreePath, ["diff", "--name-only", "--diff-filter=U"], signal)
    const paths = parseConflictedPaths(conflicted.stdout)
    if (paths.length > 0) throw new Error(`${SYNC_CONFLICT}: ${paths.join(", ")}`)
    // Anything else (hook, signing key, moved ref): pass git's reason through.
    const detail = merge.stderr?.trim()
    throw new Error(detail ? `git merge ${baseRef} failed — ${detail}` : `git merge ${baseRef} failed`)
  }
  const after = await git(worktreePath, ["rev-parse", "HEAD"], signal)
  return { baseRef, alreadyCurrent: before.status === 0 && before.stdout.trim() === after.stdout.trim() }
}
