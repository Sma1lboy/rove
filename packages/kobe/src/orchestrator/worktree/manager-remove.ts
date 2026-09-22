/**
 * `remove()` — the manager's one destructive verb. Every safety decision (dirty
 * gate, salvage snapshot, orphaned-repo fallback and its managed-root guard)
 * lives in this one function.
 *
 * `git worktree remove` does TWO jobs — deregister and delete the directory —
 * and they fail APART. An undeletable path inside the tree (`chmod -w` dir,
 * read-only cache, a file an external tool holds) exits 255 AFTER the
 * deregistration landed:
 *
 *     error: failed to delete '<path>': Permission denied     # exit 255
 *     git worktree list                                       # already gone
 *     ls <path>                                               # still there
 *     git worktree remove --force <path>                      # fatal: not a working tree
 *
 * Trusting the exit code would park the task in `deletion.phase = "error"`
 * forever, since no retry/remove/prune can advance it. So a non-zero exit is
 * CLASSIFIED, and the leftover directory is reported via `onResidue`, never
 * deleted: an undeletable tree is exactly what may hold work the user wants.
 */

import path from "node:path"
import type { ExecHost } from "../../exec/exec-host.ts"
import { DIRTY_WORKTREE_CODE, describeDirtyWorktreeWork } from "../errors.ts"
import { GitCommandError, type GitRunOpts, type GitRunResult } from "./git.ts"
import { type BranchDeps, deleteBranchAnchored } from "./manager-branch.ts"
import { canonicalize, isUnderManagedWorktreesRoot, requireAbsolute } from "./paths.ts"
import type { IgnoredWorkProbe } from "./salvage-ignored.ts"
import { type SalvageRecord, salvageWorktree } from "./salvage.ts"
import { parseWorktreeListPorcelain } from "./worktree-list.ts"

/**
 * A directory left behind after git already deregistered the worktree. Not an
 * error — task/branch bookkeeping can complete. Reported so a human sees it:
 * nothing in Rove will ever list this directory again.
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
  /**
   * The owning repo, when known. Load-bearing only once the DIRECTORY IS GONE:
   * the stale `.git/worktrees/<name>` record can only be pruned from the owning
   * repo, and `~/.rove/worktrees/<key>` is inside no repo to discover it from.
   * Path-only callers keep the best-effort discovery fallback.
   */
  readonly repo?: string
  /**
   * The checked-out branch, when known. Same missing-directory case as
   * {@link repo}: `currentBranch` needs the directory, so without this
   * `deleteBranch: true` silently deletes nothing yet reports success.
   */
  readonly branch?: string
  /**
   * Notified when `deleteBranch` was asked and git REFUSED (unmerged under
   * `-d`, or checked out in another worktree). The removal still succeeds;
   * this stops the caller reporting a branch it never deleted.
   */
  readonly onBranchKept?: (kept: { readonly branch: string; readonly reason: string }) => void
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
  /** The gitignored paths a removal would destroy — work `isDirty` is blind to,
   *  or `"unknown"` when the listing did not run. */
  ignoredWork(worktreePath: string): Promise<IgnoredWorkProbe>
  /** Deps for the opt-in post-removal branch delete. */
  branchDeps(): BranchDeps
}

/**
 * Whether `repo` still has a worktree registered at `worktreePath`.
 *
 * `rev-parse --git-common-dir` from inside the path CANNOT answer this:
 * discovery walks up parents, so a worktree nested in its own repo (every
 * remote project's `<checkout>/.rove/worktrees/<slug>`, every legacy
 * repo-local root) resolves to that repo even after deregistration, and every
 * removal would throw forever. Ask the owning repo's `worktree list`.
 *
 * git reports the canonical path (`/private/var/...` on macOS), so both sides
 * are canonicalized — locally only; local `realpath` says nothing about a
 * remote host.
 */
async function isRegisteredWorktree(
  deps: RemoveDeps,
  exec: ExecHost,
  repo: string,
  worktreePath: string,
): Promise<boolean> {
  const out = await deps.runGit(exec, ["worktree", "list", "--porcelain"], {
    cwd: repo,
    allowFail: true,
    readOnly: true,
  })
  if (out.exitCode !== 0) return false
  const same = (a: string, b: string) => (exec.isRemote ? a === b : canonicalize(a) === canonicalize(b))
  return parseWorktreeListPorcelain(out.stdout).some((e) => e.path !== undefined && same(e.path, worktreePath))
}

/**
 * Whether `worktreePath` is the residue of a DEREGISTERED worktree — git
 * dropped its registration and then failed to unlink the tree.
 *
 * A linked worktree's `.git` FILE (`gitdir: <repo>/.git/worktrees/<name>`)
 * outlives deregistration, so a dangling pointer fingerprints a half-done
 * removal — but an orphan whose clone was destroyed looks the same and gets
 * the destructive handler below. Told apart by the repo end: a deregistered
 * worktree still has a live `<repo>/.git`; an orphan lost it.
 *
 * Fast path only: macOS git leaves the pointer file, Linux git unlinks it
 * before failing. The convergence that holds everywhere is the
 * "directory still there" post-condition check below.
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
 * The refusal message every non-force `remove()` gate throws.
 *
 * `DIRTY_WORKTREE_CODE` leads because the message is the only field that
 * survives the daemon wire; the rest is {@link DirtyWorktreeError}'s sentence,
 * so all three refusals read alike. Ignored paths are named because
 * `git status` cannot show them.
 *
 * No `{ force: true }` in the text: each surface offers the remedy in its own
 * vocabulary (force-delete re-prompt, `--force`).
 */
function dirtyRefusal(worktreePath: string, ignored: IgnoredWorkProbe): string {
  return `${DIRTY_WORKTREE_CODE}: ${worktreePath} has ${describeDirtyWorktreeWork(ignored)} — forcing the removal salvages it to a ref first`
}

/**
 * Remove a worktree. Refuses to remove a dirty worktree unless `opts.force`
 * is true.
 *
 * `opts.deleteBranch` also deletes the branch (`-d`, or `-D` under `force`),
 * best-effort after the worktree is gone; a refusal never masks the removal.
 *
 * With no reachable owning repo (upstream `.git` destroyed), `force` deletes
 * the orphaned directory outright — only under a Rove-managed worktrees root.
 * Without `force` that case throws.
 *
 * `force` skips the dirty check, so every force path first takes a salvage
 * snapshot ({@link salvageWorktree}) into `refs/rove/salvage/<branch>-<stamp>`.
 * This is the chokepoint all three force callers share, so the guard lives
 * here. `onSalvage` reports the ref; salvage never fails the removal.
 */
export async function removeWorktree(deps: RemoveDeps, worktreePath: string, opts?: RemoveOpts): Promise<void> {
  requireAbsolute("path", worktreePath)
  const exec = deps.execForPath(worktreePath)
  const force = opts?.force === true

  if (!(await exec.exists(worktreePath))) {
    // Directory gone, stale `.git/worktrees/` entry left; `git worktree remove`
    // refuses a missing path, so a prune IN THE OWNING REPO is the whole
    // removal. Skip it and git still lists the worktree `prunable`,
    // `git branch -D` fails forever ("used by worktree at <gone path>"), and
    // `discover-adoptable` keeps offering the ghost.
    //
    // Prefer the caller's `repo`: a spawn into the missing path returns exit -1
    // (`exec-host.ts`), so discovery walks up from the PARENT, which for
    // `~/.rove/worktrees/<key>` is in no repo (null, no prune) — or worse, in
    // an unrelated one. The fallback stays for path-only callers.
    const goneRepo = opts?.repo ?? (await deps.findRepoFor(exec, path.dirname(worktreePath)))
    if (goneRepo) {
      await deps.runGit(exec, ["worktree", "prune"], { cwd: goneRepo, allowFail: true })
      // The branch must come from the caller here (`currentBranch` needs the
      // directory), and the prune above is what makes it deletable — git
      // refuses a branch it believes a worktree has checked out. Best-effort.
      if (opts?.deleteBranch === true && opts.branch) {
        const outcome = await deleteBranchAnchored(deps.branchDeps(), exec, goneRepo, opts.branch, { force })
        if (!outcome.deleted) opts.onBranchKept?.({ branch: opts.branch, reason: outcome.reason })
      }
    }
    return
  }

  // `rev-parse --git-common-dir` from inside the worktree: answers WHICH repo,
  // never whether this is a worktree of it (nested layouts answer an ancestor).
  const repo = await deps.findRepoFor(exec, worktreePath)
  // Ownership is REGISTRATION, not reachability — see {@link isRegisteredWorktree}.
  if (repo === null || !(await isRegisteredWorktree(deps, exec, repo, worktreePath))) {
    // Residue checks run BEFORE the orphan `rm -rf` below: a deregistered
    // worktree's repo is alive, and a retry must converge on the first answer
    // without touching a directory git already failed to delete (a second
    // `worktree remove` only says `fatal: is not a working tree`). macOS is
    // answered here via the pointer; Linux by the checks below.
    if (await deregisteredWorktreeResidue(exec, worktreePath)) {
      opts?.onResidue?.({ path: worktreePath, reason: "a previous removal deregistered the worktree" })
      return
    }
    // Repo reachable, nothing registered here: the deregistered shape for a
    // nested worktree on Linux (where remote projects live), whose git unlinks
    // the `.git` pointer. Reported, never deleted — it sits inside the user's
    // own checkout, so the orphan `rm -rf` must not reach it.
    if (repo) {
      opts?.onResidue?.({ path: worktreePath, reason: "a previous removal deregistered the worktree" })
      return
    }
    // No owning repo: upstream `.git` gone (deleted clone, or macOS pruning a
    // checkout under `/tmp`); nothing to `worktree remove` or deregister.
    //
    // Without `force` it stays an error — the directory may hold work. With
    // `force`, refusing would park the task in `deletion.phase: "error"` with
    // no supported way out; `force` already means "delete without verifying".
    //
    // Guarded by path, not caller trust: only a directory under a Rove-managed
    // worktrees root is ours to delete.
    if (!force) {
      throw new Error(`remove(): ${worktreePath} is not a git worktree`)
    }
    // The caller's repo expands a `$project_dir` base; without it that preset's
    // worktrees fall outside the default roots and the guard refuses paths
    // Rove created. Path-only callers get the default-root answer.
    if (!isUnderManagedWorktreesRoot(worktreePath, opts?.repo)) {
      throw new Error(
        `remove(): ${worktreePath} has no reachable git repo and is not under a Rove worktrees root; refusing to delete it`,
      )
    }
    // No salvage: it needs `git` in the worktree, and reaching this point
    // means git cannot resolve one.
    opts?.onSalvage?.(null)
    await exec.run(["rm", "-rf", worktreePath])
    // Post-condition: `rm -rf` can exit 0 having deleted only what it could.
    // Also where a retried residue converges when git unlinked the `.git`
    // pointer (the fingerprint above never matches).
    if (await exec.exists(worktreePath)) {
      opts?.onResidue?.({ path: worktreePath, reason: "the directory could not be deleted" })
    }
    return
  }

  // Read HEAD BEFORE removal. The worktree's own HEAD beats the caller's
  // (possibly stale) `branch`, which is only the fallback.
  const branch = opts?.deleteBranch
    ? ((await deps.currentBranch(worktreePath).catch(() => null)) ?? opts.branch ?? null)
    : null

  if (force) {
    // Last moment the doomed files exist, and the only place that sees what
    // `force` skips.
    const salvaged = await salvageWorktree({ runGit: (e, a, o) => deps.runGit(e, a, o) }, exec, worktreePath)
    opts?.onSalvage?.(salvaged)
  } else {
    // Every refusal goes through `dirtyRefusal`: the RPC layer rebuilds errors
    // as `new Error(message)`, so the code prefix is all a remote caller can
    // match to offer the force-delete re-prompt.
    if (await deps.isDirty(worktreePath)) {
      throw new Error(dirtyRefusal(worktreePath, []))
    }
    // `status --porcelain` is blind to `.gitignore`d entries, so a worktree
    // holding only `HANDOFF.md` or `.scratch/` reads clean and would be
    // destroyed with no salvage (only force takes one). Same rule as the
    // snapshot, so the refusal names what a `--force` retry would rescue.
    // NOT `.catch(() => [])`: an empty list is permission to destroy, so a
    // failed probe must not grant it — same as `isDirty` letting its failure
    // throw.
    const ignored = await deps.ignoredWork(worktreePath)
    if (ignored === "unknown" || ignored.length > 0) {
      throw new Error(dirtyRefusal(worktreePath, ignored))
    }
  }

  // git's `--force` = "remove even if locked / submodule mods". Dirty refusal
  // lives in our layer, not git's.
  const args = force ? ["worktree", "remove", "--force", worktreePath] : ["worktree", "remove", worktreePath]
  const result = await deps.runGit(exec, args, { cwd: repo, allowFail: true })
  if (result.exitCode !== 0) {
    // Classify by re-probing registration, not the exit code. Still registered
    // → nothing happened, throw. Gone → deregistered, only the directory left.
    if (await isRegisteredWorktree(deps, exec, repo, worktreePath)) {
      throw new GitCommandError(args, repo, result)
    }
    opts?.onResidue?.({ path: worktreePath, reason: result.stderr.trim() || result.stdout.trim() || "unknown" })
  }

  // Defensive: the remove can leave `.git/worktrees/<name>/` behind (rare;
  // seen in vibe-kanban).
  await deps.runGit(exec, ["worktree", "prune"], { cwd: repo, allowFail: true })

  // Anchored like `deleteBranch`: `-D` takes the reflog too, and this
  // worktree's reflog died with the directory. Runs on the residue path too —
  // the branch is checked out nowhere by then.
  if (branch) {
    const outcome = await deleteBranchAnchored(deps.branchDeps(), exec, repo, branch, { force })
    if (!outcome.deleted) opts?.onBranchKept?.({ branch, reason: outcome.reason })
  }
}
