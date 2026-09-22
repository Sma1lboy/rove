/**
 * Collect a task's branch back into its base repo: merge or squash-merge into
 * the base checkout's CURRENT branch. Refuses a dirty base up front; on
 * conflict, `git merge --abort` and throw the conflicted files for a human to
 * resolve. Git CLI through the same {@link ExecHost} as the worktree manager.
 */

import type { LandResult } from "@sma1lboy/kobe-daemon/daemon/contracts"
import { pathWithin, samePath } from "@sma1lboy/kobe-daemon/path-identity"
import type { ExecHost } from "../exec/exec-host.ts"
import type { Task, TaskId } from "../types/task.ts"
import { GitCommandFailedError, LandConflictError } from "./errors.ts"
import { baseRepoCtx, landGit as git, landPreflight, landRefusalError } from "./land-preflight.ts"
import { type WorktreeExecDeps, defaultExecDeps } from "./worktree/exec-deps.ts"
import type { WorktreeResidue } from "./worktree/manager-remove.ts"
import type { GitWorktreeManager } from "./worktree/manager.ts"
import { canonicalize } from "./worktree/paths.ts"
import type { SalvageRecord } from "./worktree/salvage.ts"

export type { LandResult }

type LandStrategy = "merge" | "squash"

export interface LandTaskInput {
  readonly strategy?: LandStrategy
}

export interface LandTaskOpts {
  readonly strategy?: LandStrategy
  readonly deleteBranch?: boolean
  /** Default ON (a landed worktree is dead weight nobody prunes); the branch
   *  stays. Never forces — see {@link LandWorktreeCleanup}. */
  readonly removeWorktree?: boolean
  /** A caller inside the worktree it asks to remove is refused. */
  readonly callerCwd?: string
}

export interface LandDeps {
  readonly worktrees: Pick<GitWorktreeManager, "deleteBranch" | "remove">
  readonly clearWorktreePath: (id: TaskId | string) => Promise<void>
  /** Kill the engine before its worktree goes. Injected: the session host in
   *  `core/` already imports this layer. Unset = no session to tear down. */
  readonly tearDownSession?: (id: TaskId | string) => Promise<void>
}

/** Reported, never thrown. `reason` can accompany `removed: true` when only
 *  clearing the task's worktree path failed. */
interface LandWorktreeCleanup {
  /** Git registration gone — TRUE even if the directory survived ({@link residue}). */
  readonly removed: boolean
  readonly reason?: string
  /** Deregistered but the directory couldn't be deleted: as complete as git
   *  can make it. The land succeeded either way. */
  readonly residue?: WorktreeResidue
}

/**
 * {@link landTask}, then cleanup: remove the worktree (default on), delete the
 * branch (opt-in). The merge has committed by then, so cleanup failures are
 * reported in the result, never thrown.
 */
export async function landTaskWithCleanup(task: Task, opts: LandTaskOpts, deps: LandDeps): Promise<LandResult> {
  if (task.kind === "main") throw new Error("landTask: a main task has no branch to land")
  if (task.kind === "dir") throw new Error("landTask: a directory task has no Rove-managed branch to land")
  const result = await landTask(task, { strategy: opts.strategy })
  // Worktree removal BEFORE branch deletion: git won't delete a branch checked
  // out in a live worktree. The branch itself survives removal — git is the
  // durable record, the directory is not.
  const worktree = opts.removeWorktree === false ? undefined : await removeLandedWorktree(task, opts.callerCwd, deps)
  // `branch -D` drops the branch reflog, and the worktree removal just took
  // the only other one. After a squash nothing links back to the branch
  // commits, so `deleteBranch` writes an anchor (none needed after `--no-ff`,
  // whose merge commit reaches the tip).
  //
  // Gate on the worktree ACTUALLY being gone: otherwise (kept, dirty, caller's
  // cwd) git refuses the delete and it would still be reported as done.
  // No worktree ever materialised → nothing holds the branch.
  let branchAnchor: SalvageRecord | null = null
  let branchKept: { readonly reason: string } | undefined
  const worktreeGone = !task.worktreePath.trim() || worktree?.removed === true
  if (opts.deleteBranch && !worktreeGone) {
    branchKept = {
      reason: worktree?.reason ?? `worktree ${task.worktreePath} was kept, and still has the branch checked out`,
    }
  } else if (opts.deleteBranch) {
    // Git can still refuse (another worktree on the branch, a lock, a moved
    // ref); `branchKept` carries git's own reason.
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
 * Never throws (the merge has committed). Never removes the base checkout,
 * the caller's own worktree (an agent landing itself would delete its cwd), or
 * a dirty worktree (`remove()` without force refuses it).
 */
async function removeLandedWorktree(
  task: Task,
  callerCwd: string | undefined,
  deps: LandDeps,
): Promise<LandWorktreeCleanup> {
  const worktreePath = task.worktreePath.trim()
  if (!worktreePath) return { removed: false, reason: "task has no worktree on disk (never materialised)" }
  // The refusals are string compares, so normalise with the same
  // canonicalizer that matched this worktree to its task.
  const wt = canonicalize(worktreePath)
  if (samePath(wt, canonicalize(task.repo))) return { removed: false, reason: "refusing to remove the base checkout" }
  if (callerCwd) {
    if (pathWithin(wt, canonicalize(callerCwd)) !== null) {
      return {
        removed: false,
        reason: `refusing to remove the caller's own worktree (${worktreePath}) — re-run from outside it`,
      }
    }
  }
  // Kill the engine BEFORE unlinking its directory: it may have written since
  // `landTask`'s dirty check, and `git worktree remove` succeeds against a live
  // cwd — later writes go to an unlinked inode, lost. After the refusals so a
  // no-op land doesn't kill a session. Ordering, not gating: a teardown
  // failure must not strand the worktree; `remove()`'s dirty refusal is the
  // real guard on unsaved work.
  if (deps.tearDownSession) {
    try {
      await deps.tearDownSession(task.id)
    } catch {
      // best-effort; the dirty-refusal in remove() below is the real guard
    }
  }
  // A half-completed removal (deregistered, directory undeletable) resolves:
  // `removed: false` would send the user to retry what git can't act on.
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
  // The directory is gone: `removed: true` regardless; a failed store write
  // (dangling `worktreePath`) goes in `reason`.
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

/** Conflicted paths after a failed merge: `git diff --name-only --diff-filter=U`. */
async function conflictedFiles(exec: ExecHost, dir: string): Promise<string[]> {
  const out = await git(exec, dir, ["diff", "--name-only", "--diff-filter=U"], { readOnly: true })
  return out.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}

/**
 * Preconditions are {@link landPreflight}'s (shared with the confirm and
 * `--dry-run`); its refusal is thrown. On conflict: abort (base unchanged) and
 * throw {@link LandConflictError}. Returns the resulting commit's short SHA.
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
      // After `landPreflight` proved the branch ahead, the usual cause is a
      // hook, signing key or unset user.email, not "nothing to commit".
      // `diff --cached --quiet` exits 0 only when nothing is staged.
      const staged = await git(exec, dir, ["diff", "--cached", "--quiet"], { readOnly: true })
      if (staged.exitCode === 0) {
        await git(exec, dir, ["reset", "--hard", "HEAD"]).catch(() => {})
        throw new Error(`landTask: '${branch}' has nothing to land onto '${landedOn}' (already merged or empty)`)
      }
      // Staged but uncommittable: NO reset — don't discard a good merge over
      // a one-command fix.
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
      // No conflicted files = not a conflict: git refused at commit time
      // (hook, signing key, user.email). Reporting LAND_CONFLICT would be a
      // phantom. The abort already ran, so the base is clean.
      if (files.length === 0) {
        throw new GitCommandFailedError(
          `merge --no-ff (landing '${branch}' onto '${landedOn}')`,
          merge.stderr,
          "the merge was aborted, so the base checkout is unchanged",
        )
      }
      throw new LandConflictError(task.id, branch, files)
    }
    // An already-merged branch exits 0 ("Already up to date.") without moving
    // HEAD; reject it like the squash path instead of a fake success.
    const after = (await git(exec, dir, ["rev-parse", "HEAD"], { readOnly: true })).stdout.trim()
    if (before === after) {
      throw new Error(`landTask: '${branch}' has nothing to land onto '${landedOn}' (already merged or empty)`)
    }
  }

  const shaOut = await git(exec, dir, ["rev-parse", "--short", "HEAD"], { readOnly: true })
  return { branch, strategy, landedOn, commit: shaOut.stdout.trim() }
}
