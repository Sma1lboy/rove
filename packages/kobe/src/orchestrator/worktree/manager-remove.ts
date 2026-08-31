/**
 * `remove()`, split out of `manager.ts` (file-size cap).
 *
 * Worktree removal is the module's one destructive verb, and every safety
 * decision it makes — the dirty gate, the salvage snapshot, the orphaned-repo
 * fallback and its managed-root guard — lives in this single function. Same
 * shape as `manager-branch.ts` / `manager-list.ts`: a free function over a
 * small deps object, with the class method a thin delegator. No behaviour
 * change in the extraction.
 */

import type { ExecHost } from "../../exec/exec-host.ts"
import type { GitRunOpts, GitRunResult } from "./git.ts"
import { type BranchDeps, deleteBranchAnchored } from "./manager-branch.ts"
import { isUnderManagedWorktreesRoot, requireAbsolute } from "./paths.ts"
import { type SalvageRecord, salvageWorktree } from "./salvage.ts"

export interface RemoveOpts {
  readonly force?: boolean
  readonly deleteBranch?: boolean
  /** Notified with the snapshot a force-removal took (null = nothing to
   *  save, or the snapshot could not be written). */
  readonly onSalvage?: (record: SalvageRecord | null) => void
}

/** The manager primitives removal borrows. */
export interface RemoveDeps {
  runGit(exec: ExecHost, args: readonly string[], opts: GitRunOpts): Promise<GitRunResult>
  /** ExecHost for a worktree path. */
  execForPath(worktreePath: string): ExecHost
  /** The repo owning a worktree path, or null when it isn't one. */
  findRepoFor(exec: ExecHost, worktreePath: string): Promise<string | null>
  /** The worktree's checked-out branch. */
  currentBranch(worktreePath: string): Promise<string | null>
  /** Whether the worktree has uncommitted or untracked changes. */
  isDirty(worktreePath: string): Promise<boolean>
  /** Deps for the opt-in post-removal branch delete. */
  branchDeps(): BranchDeps
}

/**
 * Remove a worktree. Refuses to remove a dirty worktree unless `opts.force`
 * is true.
 *
 * On success the directory is gone and the worktree is deregistered from the
 * repo's metadata. The branch is left in place UNLESS `opts.deleteBranch` is
 * set — then it's also deleted (`git branch -d`, or `-D` under `force`), so a
 * task delete/land doesn't leave the loser branch piling up. Branch deletion
 * is best-effort: it runs after the worktree is gone and a failure (branch
 * checked out elsewhere, name gone) is swallowed, never masking a successful
 * removal.
 *
 * `force` also covers the case where the worktree has no reachable owning repo
 * (its upstream `.git` was destroyed): there is no `git worktree remove` to
 * run, so a forced removal deletes the orphaned directory outright — but only
 * when it sits under a Rove-managed worktrees root. Without `force` that case
 * still throws, as before.
 *
 * `force` bypasses the dirty check, so uncommitted edits and untracked files
 * are destroyed. Every force path first takes a salvage snapshot
 * ({@link salvageWorktree}) into `refs/rove/salvage/<branch>-<stamp>` — this is
 * the one chokepoint all three force callers share, so the guard lives here
 * rather than in each of them. `onSalvage` reports the ref so the caller can
 * surface it; salvage never fails the removal the caller asked for.
 */
export async function removeWorktree(deps: RemoveDeps, worktreePath: string, opts?: RemoveOpts): Promise<void> {
  requireAbsolute("path", worktreePath)
  const exec = deps.execForPath(worktreePath)
  const force = opts?.force === true

  if (!(await exec.exists(worktreePath))) {
    // Best-effort metadata prune — the directory may be gone but a stale
    // entry can survive in `.git/worktrees/`. `git worktree remove` will
    // refuse, so we use prune.
    const goneRepo = await deps.findRepoFor(exec, worktreePath)
    if (goneRepo) await deps.runGit(exec, ["worktree", "prune"], { cwd: goneRepo, allowFail: true })
    return
  }

  // Resolve the owning repo via `rev-parse --git-common-dir` from inside the
  // worktree itself. This is the only reliable way to get back to the main
  // repo when the caller hands us only the path.
  const repo = await deps.findRepoFor(exec, worktreePath)
  if (!repo) {
    // No owning repo: the upstream checkout's `.git` is gone (a deleted
    // clone, or macOS pruning a checkout under `/tmp`), so there is no
    // `git worktree remove` to run and no metadata left to deregister.
    //
    // Without `force` this stays an error — the directory may hold work and
    // the caller has not said to destroy it. WITH force, refusing is the
    // worse answer: the deletion state machine marks the task
    // `deletion.phase: "error"`, and every retry re-runs this same
    // unsatisfiable path, so the entry can never be removed by any supported
    // command. `force` already means "delete it even though I can't verify
    // what's inside"; an unreachable repo is one more case of exactly that.
    //
    // Guarded by path, not by trust in the caller: only a directory under a
    // Rove-managed worktrees root is ours to delete outright.
    if (!force) {
      throw new Error(`remove(): ${worktreePath} is not a git worktree`)
    }
    if (!isUnderManagedWorktreesRoot(worktreePath)) {
      throw new Error(
        `remove(): ${worktreePath} has no reachable git repo and is not under a Rove worktrees root; refusing to delete it`,
      )
    }
    // No salvage: it needs `git` in the worktree, and reaching this point
    // means git cannot resolve one.
    opts?.onSalvage?.(null)
    await exec.run(["rm", "-rf", worktreePath])
    return
  }

  // Capture the branch BEFORE removal (once the worktree is gone we can't
  // read its HEAD) so an opt-in `deleteBranch` can clean it up after.
  const branch = opts?.deleteBranch ? await deps.currentBranch(worktreePath).catch(() => null) : null

  if (force) {
    // The last moment at which the doomed files still exist. The dirty check
    // below is exactly what `force` skips, so this is also the only place
    // that still sees what is being skipped over.
    const salvaged = await salvageWorktree({ runGit: (e, a, o) => deps.runGit(e, a, o) }, exec, worktreePath)
    opts?.onSalvage?.(salvaged)
  } else {
    const dirty = await deps.isDirty(worktreePath)
    if (dirty) {
      throw new Error(
        `remove(): refusing to remove dirty worktree at ${worktreePath} (pass { force: true } to override)`,
      )
    }
  }

  // `--force` here is the git CLI's "remove even if locked / has submodule
  // mods" flag. Even with our `force=false` early-out, we pass --force to git
  // so an unlocked-but-untracked-files case (rare — we already checked dirty)
  // doesn't bounce. Dirty refusal lives in our layer, not git's.
  const args = force ? ["worktree", "remove", "--force", worktreePath] : ["worktree", "remove", worktreePath]
  await deps.runGit(exec, args, { cwd: repo })

  // Defensive prune — cleans up `.git/worktrees/<name>/` if the remove left
  // it behind (rare, but documented in vibe-kanban).
  await deps.runGit(exec, ["worktree", "prune"], { cwd: repo, allowFail: true })

  // Anchored like `deleteBranch`: `-D` takes the reflog too, and this
  // worktree's own reflog died with the directory a few lines up.
  if (branch) await deleteBranchAnchored(deps.branchDeps(), exec, repo, branch, { force })
}
