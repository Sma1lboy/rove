/**
 * `landTask` executor — collect a task's branch back into its base repo.
 *
 * The product unit is `Task = worktree + engine session + branch`, and every
 * step of that had a product path EXCEPT the last one: collecting the branch.
 * Every fan-out round ("pick the winner") and every task wrap-up meant leaving
 * kobe to hand-run `git merge` in the main checkout, self-check it was clean,
 * and copy the conflict list by hand. This does that one step.
 *
 * v1 scope (deliberately small — see the orch brief): merge OR squash-merge the
 * task's branch into the base repo's CURRENT branch, in the main checkout.
 * Refuse up front if the main checkout is dirty (same guard shape as
 * `deleteTask`'s {@link DirtyWorktreeError}). On a merge conflict, `git merge
 * --abort` immediately and throw the conflicted-file list — the human resolves
 * it by hand for now (auto-repair-via-engine is v2). Zero new deps: git CLI
 * subprocesses through the same {@link ExecHost} the worktree manager uses.
 */

import path from "node:path"
import type { ExecHost } from "../exec/exec-host.ts"
import type { Task, TaskId } from "../types/task.ts"
import { GitCommandFailedError, LandConflictError } from "./errors.ts"
import { baseRepoCtx, landGit as git, landPreflight, landRefusalError } from "./land-preflight.ts"
import { type WorktreeExecDeps, defaultExecDeps } from "./worktree/exec-deps.ts"
import type { WorktreeResidue } from "./worktree/manager-remove.ts"
import type { GitWorktreeManager } from "./worktree/manager.ts"
import { canonicalize } from "./worktree/paths.ts"
import type { SalvageRecord } from "./worktree/salvage.ts"

type LandStrategy = "merge" | "squash"

export interface LandTaskInput {
  readonly strategy?: LandStrategy
}

/** Options for a full land: strategy + post-land cleanup. */
export interface LandTaskOpts {
  readonly strategy?: LandStrategy
  /** Delete the task's branch after a successful land. */
  readonly deleteBranch?: boolean
  /**
   * Remove the task's worktree after a successful land (the branch stays).
   * Defaults to ON: once a branch is landed its worktree is dead weight, and
   * leaving one behind per land piles up directories nobody prunes. Pass
   * `false` to keep it. Never forces — see {@link LandWorktreeCleanup}.
   */
  readonly removeWorktree?: boolean
  /** The land caller's cwd — a caller inside the worktree it asks to remove is refused. */
  readonly callerCwd?: string
}

/** Collaborators `landTaskWithCleanup` drives for the post-land steps. */
export interface LandDeps {
  readonly worktrees: Pick<GitWorktreeManager, "deleteBranch" | "remove">
  /** Unlink the task's worktreePath after its worktree is removed. */
  readonly clearWorktreePath: (id: TaskId | string) => Promise<void>
  /**
   * Kill the task's engine session before its worktree directory goes.
   * Injected rather than imported: the session host lives in `core/`, which
   * already imports this layer. Unset (a TUI-local orchestrator, a test) means
   * no session to tear down.
   */
  readonly tearDownSession?: (id: TaskId | string) => Promise<void>
}

/**
 * Outcome of the post-land worktree removal — reported in the result, never
 * thrown. `reason` is not failure-only: it also accompanies `removed: true`
 * when the directory went but clearing the task's worktree path did not.
 */
interface LandWorktreeCleanup {
  /** Whether git's registration of the worktree is gone. TRUE even when the
   *  directory survived — see {@link residue}. */
  readonly removed: boolean
  readonly reason?: string
  /**
   * Set when git deregistered the worktree but could not delete its directory.
   * Distinct from `reason`, which reports a bookkeeping failure on a fully
   * successful removal: this one says the removal is as complete as git can
   * make it and a directory is left on disk. The land succeeded either way.
   */
  readonly residue?: WorktreeResidue
}

/**
 * Land `task`'s branch (via {@link landTask}) and then run the cleanup: drop
 * the now-landed worktree (on by default), delete the branch after a successful land (both opt-in). The merge has already
 * committed once cleanup runs, so it must stand — a `deleteBranch` failure is
 * best-effort inside `remove`-style deletion. Extracted from the orchestrator
 * so `core.ts` stays a thin delegator.
 */
export async function landTaskWithCleanup(task: Task, opts: LandTaskOpts, deps: LandDeps): Promise<LandResult> {
  if (task.kind === "main") throw new Error("landTask: a main task has no branch to land")
  if (task.kind === "dir") throw new Error("landTask: a directory task has no Rove-managed branch to land")
  const result = await landTask(task, { strategy: opts.strategy })
  // Worktree removal runs BEFORE branch deletion: git refuses to delete a
  // branch that's still checked out in a live worktree, so the reverse order
  // would leave --delete-branch a silent no-op when combined with it.
  //
  // Removal is the DEFAULT, not an opt-in: a landed task's worktree is spent,
  // and the opt-in shape meant every land left one behind. Only an explicit
  // `removeWorktree: false` keeps it. The BRANCH is untouched either way —
  // git is the durable record, the directory is not.
  const worktree = opts.removeWorktree === false ? undefined : await removeLandedWorktree(task, opts.callerCwd, deps)
  // `deleteBranch` is `branch -D`, which drops the branch's reflog as well as
  // its ref — and the worktree removed on the line above took the only OTHER
  // reflog (`.git/worktrees/<slug>/logs/HEAD`) with it. Under `--strategy
  // squash` the base's new commit has no link back to the branch's commits,
  // so without an anchor those commits are reachable from nothing at all.
  // `deleteBranch` writes one and reports it here; on a `--no-ff` merge it
  // finds the merge commit already reaches the tip and writes nothing.
  //
  // Gate it on the worktree ACTUALLY being gone. git refuses to delete a
  // branch a live worktree has checked out, and `deleteBranch` is best-effort
  // (`allowFail`, exit code discarded) — so every path that keeps the worktree
  // (`removeWorktree: false`, a dirty tree, the caller's own cwd) would
  // otherwise run the delete, have git refuse it, and report success anyway,
  // anchor and all.
  // A task that never materialised a worktree has nothing holding the branch,
  // so it deletes normally.
  let branchAnchor: SalvageRecord | null = null
  let branchKept: { readonly reason: string } | undefined
  const worktreeGone = !task.worktreePath.trim() || worktree?.removed === true
  if (opts.deleteBranch && !worktreeGone) {
    branchKept = {
      reason: worktree?.reason ?? `worktree ${task.worktreePath} was kept, and still has the branch checked out`,
    }
  } else if (opts.deleteBranch) {
    // And when the worktree IS gone, the delete can still be refused — another
    // task's worktree on the same branch, a lock, a ref that moved. That used
    // to be discarded with the exit code; `branchKept` now carries git's own
    // reason instead of only the one this function predicted.
    const outcome = await deps.worktrees.deleteBranch(task.repo, result.branch, {
      force: true,
      onAnchor: (record) => {
        branchAnchor = record
      },
    })
    if (!outcome.deleted) branchKept = { reason: outcome.reason }
  }
  return {
    ...result,
    ...(worktree ? { worktree } : {}),
    ...(branchAnchor ? { branchAnchor } : {}),
    ...(branchKept ? { branchKept } : {}),
  }
}

/**
 * Post-land worktree removal. Never throws — the merge has already committed,
 * so every refusal/failure is reported in the result instead of failing the
 * land. Hard safety edges: never the base checkout, never the caller's own
 * worktree (an agent landing itself would delete its own cwd), and never a
 * dirty worktree (`remove()` without force refuses it).
 */
async function removeLandedWorktree(
  task: Task,
  callerCwd: string | undefined,
  deps: LandDeps,
): Promise<LandWorktreeCleanup> {
  const worktreePath = task.worktreePath.trim()
  if (!worktreePath) return { removed: false, reason: "task has no worktree on disk (never materialised)" }
  // Same canonicalizer that matched this worktree to its task (`canonPath` /
  // `canonicalize`, plain `fs.realpathSync`) — the refusals below are string
  // compares, so the guard must normalise exactly the way the assignment did.
  // `realpathSync.native` agrees with it everywhere we run, and one
  // implementation beats a second syscall.
  const wt = canonicalize(worktreePath)
  if (wt === canonicalize(task.repo)) return { removed: false, reason: "refusing to remove the base checkout" }
  if (callerCwd) {
    const rel = path.relative(wt, canonicalize(callerCwd))
    if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
      return {
        removed: false,
        reason: `refusing to remove the caller's own worktree (${worktreePath}) — re-run from outside it`,
      }
    }
  }
  // Kill the engine BEFORE unlinking the directory it is working in. The
  // dirty check that let this land through ran seconds ago, in `landTask`; an
  // engine still running has kept writing since. `git worktree remove`
  // succeeds against a live process anyway — POSIX unlink does not care that
  // something holds the directory as its cwd — and every write it makes after
  // that goes to an unlinked inode: not on disk, not on the branch, not
  // anywhere. Placed after the refusal checks so a land that is not going to
  // remove anything does not kill a session for nothing.
  //
  // Ordering, not gating: the merge has already committed, so a teardown
  // failure must not strand the worktree. `remove()` without force still
  // refuses a dirty tree, which is the real guard on unsaved work; a stuck
  // session that keeps writing is reported through that refusal, not by
  // aborting here.
  if (deps.tearDownSession) {
    try {
      await deps.tearDownSession(task.id)
    } catch {
      // best-effort; the dirty-refusal in remove() below is the real guard
    }
  }
  // A removal git half-completed (metadata deregistered, directory undeletable)
  // resolves rather than throws — the worktree IS deregistered, so the land's
  // cleanup is done and reporting `removed: false` would send the user to
  // retry something git cannot act on at all.
  let residue: WorktreeResidue | undefined
  try {
    await deps.worktrees.remove(worktreePath, {
      onResidue: (r) => {
        residue = r
      },
    })
  } catch (err) {
    return { removed: false, reason: errText(err) }
  }
  // Past this point the directory IS gone, so the outcome is `removed: true`
  // whatever the store write does. Folding the two calls into one try/catch
  // would report `removed: false` when only the bookkeeping failed — telling
  // the user to go look for a worktree that is already gone. The failure is
  // still reported, in `reason`, because a dangling `worktreePath` is real.
  try {
    await deps.clearWorktreePath(task.id)
  } catch (err) {
    return {
      removed: true,
      reason: `worktree removed, but clearing the task's worktree path failed: ${errText(err)}`,
      ...(residue ? { residue } : {}),
    }
  }
  return { removed: true, ...(residue ? { residue } : {}) }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export interface LandResult {
  readonly branch: string
  readonly strategy: LandStrategy
  /** The base repo's branch the work landed on. */
  readonly landedOn: string
  /** Short SHA of the merge/commit that landed the work. */
  readonly commit: string
  /** The post-land worktree cleanup outcome. Present unless removal was
   *  explicitly declined (`removeWorktree: false`). */
  readonly worktree?: LandWorktreeCleanup
  /**
   * The ref anchoring the deleted branch's tip, when `deleteBranch` deleted a
   * branch nothing else kept reachable — i.e. after a squash land, where the
   * base's new commit has no link back to the branch's own commits. Absent on
   * a `--no-ff` merge (the merge commit already reaches them) and when no
   * branch was deleted. Reported so a user can recover the pre-squash history
   * without knowing `refs/rove/salvage` exists.
   */
  readonly branchAnchor?: { readonly ref: string; readonly commit: string }
  /**
   * Set when `deleteBranch` was asked for and the branch was NOT deleted,
   * because its worktree is still on disk with the branch checked out — git
   * would refuse the delete, so Rove does not pretend it happened. `reason` is
   * the worktree cleanup's own refusal (dirty tree, base checkout, caller's own
   * cwd) or the explicit `removeWorktree: false`. Re-run the land's cleanup
   * (or remove the worktree by hand) and the branch deletes.
   */
  readonly branchKept?: { readonly reason: string }
}

/** Conflicted paths after a failed merge: `git diff --name-only --diff-filter=U`. */
async function conflictedFiles(exec: ExecHost, dir: string): Promise<string[]> {
  const out = await git(exec, dir, ["diff", "--name-only", "--diff-filter=U"], { readOnly: true })
  return out.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}

/**
 * Land `task`'s branch into its base repo's current branch.
 *
 * Every precondition — a branch to land, a base checkout on a branch that is
 * not this one, a clean base, a ref git can still resolve, at least one commit
 * ahead — is {@link landPreflight}'s to answer, and this function throws
 * whatever it refuses. That is the point of the split: the confirm dialog and
 * `land --dry-run` ask the SAME function, so a land the user was told would
 * happen cannot be refused a moment later for a reason nobody showed them.
 *
 * On conflict: abort the merge (leaving the base checkout exactly as it was) and
 * throw {@link LandConflictError} with the conflicted paths. On success: return
 * the branch, the base branch it landed on, and the resulting commit's short SHA.
 */
export async function landTask(
  task: Task,
  input: LandTaskInput = {},
  deps: WorktreeExecDeps = defaultExecDeps,
): Promise<LandResult> {
  const strategy: LandStrategy = input.strategy ?? "merge"
  const preflight = await landPreflight(task, deps)
  if (preflight.refusal) throw landRefusalError(task, { ...preflight, refusal: preflight.refusal })
  const { branch, landedOn } = preflight
  const { exec, dir } = baseRepoCtx(task.repo, deps)

  if (strategy === "squash") {
    const merge = await git(exec, dir, ["merge", "--squash", branch])
    if (merge.exitCode !== 0) {
      const files = await conflictedFiles(exec, dir)
      await git(exec, dir, ["merge", "--abort"]).catch(() => {})
      // `--squash` stages without committing; if it half-applied without a
      // clean conflict marker, reset the index/tree back to HEAD.
      await git(exec, dir, ["reset", "--hard", "HEAD"]).catch(() => {})
      throw new LandConflictError(task.id, branch, files)
    }
    const commit = await git(exec, dir, ["commit", "--no-edit", "-m", `Land ${branch} (squash)`])
    if (commit.exitCode !== 0) {
      // "Nothing to commit" is only ONE reason `git commit` exits non-zero,
      // and after `assertBranchHasWork` proved the branch is ahead and the
      // squash staged cleanly it is nearly never the reason — a hook, a
      // broken signing key or an unset user.email is. Ask git which it was
      // instead of assuming: `diff --cached --quiet` exits 0 only when
      // genuinely nothing is staged.
      const staged = await git(exec, dir, ["diff", "--cached", "--quiet"], { readOnly: true })
      if (staged.exitCode === 0) {
        // Genuinely empty. Reset the squash's staged index so the base
        // checkout is untouched, and report it as before.
        await git(exec, dir, ["reset", "--hard", "HEAD"]).catch(() => {})
        throw new Error(`landTask: '${branch}' has nothing to land onto '${landedOn}' (already merged or empty)`)
      }
      // The squash IS staged and git refused to commit it. NO reset — that
      // would throw away a merge that succeeded, over a problem the user can
      // fix in one command.
      throw new GitCommandFailedError(
        `commit (squash-landing '${branch}' onto '${landedOn}')`,
        commit.stderr,
        "the squashed merge is left STAGED in the base checkout — fix the cause and `git commit` it, or `git reset --hard HEAD` to discard",
      )
    }
  } else {
    const before = (await git(exec, dir, ["rev-parse", "HEAD"], { readOnly: true })).stdout.trim()
    const merge = await git(exec, dir, ["merge", "--no-ff", "-m", `Land ${branch}`, branch])
    if (merge.exitCode !== 0) {
      const files = await conflictedFiles(exec, dir)
      await git(exec, dir, ["merge", "--abort"]).catch(() => {})
      // An EMPTY conflicted list with a failed merge is NOT a conflict — the
      // trees merged and git refused at commit time (hook, signing key,
      // unset user.email). That is exactly the phantom-LAND_CONFLICT shape
      // `assertBranchHasWork`'s docstring exists to prevent; it just arrives
      // through the commit door instead of the ref door. The abort above
      // still ran, so the base checkout is clean either way.
      if (files.length === 0) {
        throw new GitCommandFailedError(
          `merge --no-ff (landing '${branch}' onto '${landedOn}')`,
          merge.stderr,
          "the merge was aborted, so the base checkout is unchanged",
        )
      }
      throw new LandConflictError(task.id, branch, files)
    }
    // `git merge --no-ff` on an already-merged/empty branch exits 0 with
    // "Already up to date." and creates NO commit — HEAD does not move. Guard
    // it the same way the squash path guards its empty `git commit`, so both
    // strategies reject a nothing-to-land branch instead of the merge path
    // reporting a fake success on the unchanged base commit.
    const after = (await git(exec, dir, ["rev-parse", "HEAD"], { readOnly: true })).stdout.trim()
    if (before === after) {
      throw new Error(`landTask: '${branch}' has nothing to land onto '${landedOn}' (already merged or empty)`)
    }
  }

  const shaOut = await git(exec, dir, ["rev-parse", "--short", "HEAD"], { readOnly: true })
  return { branch, strategy, landedOn, commit: shaOut.stdout.trim() }
}
