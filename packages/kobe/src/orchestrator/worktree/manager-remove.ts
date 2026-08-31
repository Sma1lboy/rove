/**
 * `remove()`, split out of `manager.ts` (file-size cap).
 *
 * Worktree removal is the module's one destructive verb, and every safety
 * decision it makes — the dirty gate, the salvage snapshot, the orphaned-repo
 * fallback and its managed-root guard — lives in this single function. Same
 * shape as `manager-branch.ts` / `manager-list.ts`: a free function over a
 * small deps object, with the class method a thin delegator.
 *
 * The other thing this function has to get right: `git worktree remove` does
 * TWO jobs — deregister the worktree's metadata and delete its directory — and
 * they can fail APART. An undeletable path inside the tree (a `chmod -w`
 * directory, a read-only dependency cache, anything an external tool holds)
 * produces exit 255 AFTER the deregistration has already landed:
 *
 *     error: failed to delete '<path>': Permission denied     # exit 255
 *     git worktree list                                       # already gone
 *     ls <path>                                               # still there
 *     git worktree remove --force <path>                      # fatal: not a working tree
 *
 * Reading the exit code as the whole truth reports that as a total failure and
 * leaves the caller with no forward move: git's own view is that this worktree
 * no longer exists, so no retry, remove, or prune can ever advance it (issue
 * #89 — a task parked in `deletion.phase = "error"` forever). So a non-zero
 * exit is CLASSIFIED, not trusted, and the leftover directory is reported
 * through `onResidue` rather than deleted: an undeletable tree is exactly the
 * kind of thing that holds something the user still wants.
 */

import type { ExecHost } from "../../exec/exec-host.ts"
import { GitCommandError, type GitRunOpts, type GitRunResult } from "./git.ts"
import { type BranchDeps, deleteBranchAnchored } from "./manager-branch.ts"
import { isUnderManagedWorktreesRoot, requireAbsolute } from "./paths.ts"
import { type SalvageRecord, salvageWorktree } from "./salvage.ts"

/**
 * A directory a removal left behind after git had already deregistered the
 * worktree. Not an error: git's half of the job is done and the task/branch
 * bookkeeping around it can complete. It is reported so the path and the
 * reason reach a human — nothing else in Rove will ever list this directory
 * again, because from git's side the worktree is gone.
 */
export interface WorktreeResidue {
  /** The directory still on disk. */
  readonly path: string
  /** git's own reason the delete stopped (its stderr), e.g. "Permission denied". */
  readonly reason: string
}

export interface RemoveOpts {
  readonly force?: boolean
  readonly deleteBranch?: boolean
  /** Notified with the snapshot a force-removal took (null = nothing to
   *  save, or the snapshot could not be written). */
  readonly onSalvage?: (record: SalvageRecord | null) => void
  /** Notified when git deregistered the worktree but could not delete its
   *  directory. Fires on the retry of such a removal too, so a second call
   *  converges on the same answer instead of `is not a working tree`. */
  readonly onResidue?: (residue: WorktreeResidue) => void
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
 * Whether `worktreePath` is the residue of a DEREGISTERED worktree — git
 * dropped its registration and then failed to unlink the tree.
 *
 * A linked worktree's `.git` is a FILE holding
 * `gitdir: <repo>/.git/worktrees/<name>`. That file outlives the
 * deregistration, so a dangling pointer is the on-disk fingerprint of a
 * half-done removal — but it is ALSO what an orphaned worktree looks like
 * after its upstream clone was destroyed, which is a different case with a
 * different (destructive) handler below. The two are told apart by the repo
 * end of the pointer: a deregistered worktree still has a live `<repo>/.git`
 * and has lost only its own `worktrees/<name>` admin dir; an orphan has lost
 * the whole thing.
 *
 * Platform-dependent, which is why it is a fast path and not the only one:
 * macOS git leaves the pointer file, Linux git unlinks it before failing, and
 * then the directory is indistinguishable from any other. The convergence that
 * holds everywhere is the post-condition check further down — "the directory
 * is still there" — not this fingerprint.
 */
async function deregisteredWorktreeResidue(exec: ExecHost, worktreePath: string): Promise<boolean> {
  const dotGit = await exec.readFile(`${worktreePath}/.git`)
  const pointer = dotGit
    ?.trim()
    .match(/^gitdir:\s*(.+)$/)?.[1]
    ?.trim()
  if (!pointer) return false
  const marker = "/worktrees/"
  const at = pointer.lastIndexOf(marker)
  if (at < 0) return false
  // `<repo>/.git` — alive for a deregistered worktree, gone for an orphan.
  return await exec.exists(pointer.slice(0, at))
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
    // Checked BEFORE the orphan handling below, which shares this branch: a
    // deregistered worktree also has no reachable repo, but its own repo is
    // alive and the correct answer is to converge without touching a directory
    // the previous removal already refused to delete.
    //
    // Retrying a removal that already deregistered its worktree must land on
    // the same answer it gave the first time — git can no longer act on this
    // path at all, so a second `worktree remove` only ever says `fatal: is not
    // a working tree` and the caller is stuck (issue #89). Where the pointer
    // survives (macOS) that is answered here; where it does not (Linux) the
    // post-`rm -rf` check below answers it.
    if (await deregisteredWorktreeResidue(exec, worktreePath)) {
      opts?.onResidue?.({ path: worktreePath, reason: "a previous removal deregistered the worktree" })
      return
    }
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
    // Post-condition, not optimism: `rm -rf` exits 0 having deleted only what
    // it could, so without this check an undeletable directory is reported as
    // a clean removal — the caller is told to look for something that is still
    // on disk. This is also where a retried residue converges on the platforms
    // whose git unlinks the `.git` pointer before failing, so the fingerprint
    // above never matches.
    if (await exec.exists(worktreePath)) {
      opts?.onResidue?.({ path: worktreePath, reason: "the directory could not be deleted" })
    }
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
  const result = await deps.runGit(exec, args, { cwd: repo, allowFail: true })
  if (result.exitCode !== 0) {
    // Re-probing the path is the whole classification: it answers git's own
    // question ("is this still a worktree?") rather than re-reading the exit
    // code we already have. Still registered → nothing happened, throw the
    // error the caller has always seen. Gone → the deregistration landed and
    // only the directory is left.
    if (await deps.findRepoFor(exec, worktreePath)) {
      throw new GitCommandError(args, repo, result)
    }
    opts?.onResidue?.({ path: worktreePath, reason: result.stderr.trim() || result.stdout.trim() || "unknown" })
  }

  // Defensive prune — cleans up `.git/worktrees/<name>/` if the remove left
  // it behind (rare, but documented in vibe-kanban).
  await deps.runGit(exec, ["worktree", "prune"], { cwd: repo, allowFail: true })

  // Anchored like `deleteBranch`: `-D` takes the reflog too, and this
  // worktree's own reflog died with the directory a few lines up. Runs on the
  // residue path too — the branch is no longer checked out anywhere, which is
  // the only thing that made it undeletable before.
  if (branch) await deleteBranchAnchored(deps.branchDeps(), exec, repo, branch, { force })
}
