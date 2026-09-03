/**
 * Bring a task's worktree back up to date with its base branch.
 *
 * The inverse of `land.ts`: landing merges the task's branch INTO the base
 * checkout at the end of the work, while this merges the base INTO the
 * worktree in the middle of it — the answer to the `↓N` drift chip the sidebar
 * now shows.
 *
 * MERGE, not rebase, and not negotiable: the worktree usually has a live
 * engine holding files open and possibly mid-edit. A merge that hits a
 * conflict stops with the worktree in a state `git merge --abort` can undo and
 * the engine can be told about; a rebase interrupted mid-turn leaves a
 * detached HEAD partway through a replay, which is not something a toast can
 * recover from. (`grep -rn rebase src/` returns nothing, and this keeps it
 * that way.)
 *
 * Conflict reporting mirrors `land.ts`'s `LAND_CONFLICT`: a conflict is a
 * NORMAL outcome the user acts on, so it comes back as a typed error message
 * the caller matches on (`SYNC_CONFLICT: <files>`) rather than a generic
 * failure. Unlike landing, the merge is left IN PLACE on conflict — aborting
 * it would throw away the resolution work the user is about to do, and the
 * conflicted files are exactly what they need to see.
 */

import { readOnlyGitProcessEnv } from "../lib/git-env.ts"
import { spawnCapture } from "../lib/poll-scheduling.ts"

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
 * Conflicted paths after a failed merge (`git diff --name-only
 * --diff-filter=U`). Pure enough to be worth its own function: the message
 * the user reads is built from it, and an empty list means the merge failed
 * for some OTHER reason, which must not be reported as a conflict.
 */
export function parseConflictedPaths(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/**
 * Merge `baseRef` into the worktree's current branch. Throws with a
 * `SYNC_CONFLICT: a, b, c` / `SYNC_WORKTREE_DIRTY` message on the two outcomes
 * a human can act on, and a plain message on anything else.
 */
export async function syncWorktreeWithBase(
  worktreePath: string,
  baseRef: string,
  signal: AbortSignal,
): Promise<SyncBaseResult> {
  // Refuse on a dirty worktree BEFORE touching anything: `git merge` would
  // either refuse itself with a wall of text, or (for untracked files it can
  // fast-forward over) silently overwrite them. Same guard shape as landing's
  // dirty-base refusal.
  const status = await git(worktreePath, ["status", "--porcelain=v1", "--untracked-files=no"], signal)
  if (status.status !== 0) throw new Error("git status failed")
  if (status.stdout.trim().length > 0) throw new Error(SYNC_DIRTY)

  const before = await git(worktreePath, ["rev-parse", "HEAD"], signal)
  const merge = await git(worktreePath, ["merge", "--no-edit", baseRef], signal, true)
  if (merge.status !== 0) {
    const conflicted = await git(worktreePath, ["diff", "--name-only", "--diff-filter=U"], signal)
    const paths = parseConflictedPaths(conflicted.stdout)
    if (paths.length > 0) throw new Error(`${SYNC_CONFLICT}: ${paths.join(", ")}`)
    throw new Error(`git merge ${baseRef} failed`)
  }
  const after = await git(worktreePath, ["rev-parse", "HEAD"], signal)
  return { baseRef, alreadyCurrent: before.status === 0 && before.stdout.trim() === after.stdout.trim() }
}
