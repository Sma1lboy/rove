/**
 * The READ half of landing: base checkout branch, commits ahead, base
 * dirtiness, and whether any of that refuses the land. The confirm dialog,
 * `rove api land --dry-run` and `landTask` all call this, so "may this land"
 * has one implementation and the confirm can't drift from the merge.
 */

import type { ExecHost } from "../exec/exec-host.ts"
import { READ_ONLY_GIT_ENV } from "../lib/git-env.ts"
import type { Task } from "../types/task.ts"
import { isDirtyOutput, parseDirtyPaths } from "./dirty-paths.ts"
import { EmptyBranchDirtyWorktreeError, EmptyBranchError, MainCheckoutDirtyError, MissingRefError } from "./errors.ts"
import { type WorktreeExecDeps, defaultExecDeps } from "./worktree/exec-deps.ts"
import { GitWorktreeManager } from "./worktree/manager.ts"

/** 1:1 with the error `landTask` throws ({@link landRefusalError}); the string
 *  is the wire form, so JSON-only callers branch without parsing messages. */
export type LandRefusal =
  | "DETACHED_HEAD"
  | "UNREADABLE_BASE"
  | "UNBORN_BASE"
  | "SAME_BRANCH"
  | "MAIN_CHECKOUT_DIRTY"
  | "MISSING_REF"
  | "EMPTY_BRANCH"
  | "EMPTY_BRANCH_DIRTY_WORKTREE"

export interface LandPreflight {
  /** The merge source. */
  readonly branch: string
  /** The merge DESTINATION. Empty only when there's no branch to name
   *  (detached / unreadable base). */
  readonly landedOn: string
  /** Commits on `branch` missing from `landedOn`. Absent — never a fabricated
   *  zero — when git couldn't count (detached, unresolved ref, unparseable). */
  readonly ahead?: number
  /** Uncommitted or untracked changes in the base. Absent when an earlier
   *  branch check already refused. */
  readonly baseDirty?: boolean
  /** Absent means the land may proceed. */
  readonly refusal?: LandRefusal
  /** Task worktree's uncommitted paths; only with `EMPTY_BRANCH_DIRTY_WORKTREE`. */
  readonly dirtyFiles?: readonly string[]
  /** Exact message `landTask` would throw, so confirm/dry-run report the same
   *  words instead of re-deriving them. */
  readonly message?: string
  /** The base repo's working dir (a remote basePath, or the repo itself). */
  readonly baseDir: string
}

/** Base repo's git dir + ExecHost: local path or remote basePath. */
export function baseRepoCtx(repo: string, deps: WorktreeExecDeps): { exec: ExecHost; dir: string } {
  const basePath = deps.remoteBasePath(repo)
  return { exec: deps.execForRepo(repo), dir: basePath ?? repo }
}

export async function landGit(
  exec: ExecHost,
  dir: string,
  args: readonly string[],
  opts?: { readonly readOnly?: boolean },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // Read-only probes run lock-free (READ_ONLY_GIT_ENV): an engine may be
  // committing in the worktree right now. Writes need `.git/index.lock`.
  // `stderr` is kept: on a failed write only git's message says WHY (a hook,
  // a signing key, an unset user.email).
  const r = await exec.run(["git", ...args], { cwd: dir, env: opts?.readOnly ? READ_ONLY_GIT_ENV : undefined })
  return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }
}

/** `git status --porcelain` non-empty in `dir` (untracked counts). */
export async function isDirty(exec: ExecHost, dir: string): Promise<boolean> {
  return isDirtyOutput((await landGit(exec, dir, ["status", "--porcelain"], { readOnly: true })).stdout)
}

/**
 * Read-only. Refusal precedence: detached/unreadable HEAD, same branch,
 * unborn base, dirty base, unresolvable ref, empty branch. Counts are
 * gathered even when refused (free reads, more useful dry runs).
 *
 * Zero commits catches "worker reported success, delivered nothing": a dirty
 * worktree means uncommitted work ({@link EmptyBranchDirtyWorktreeError},
 * listing files); clean or unreadable is a real no-op ({@link
 * EmptyBranchError}). Ambiguity falls to clean so the no-op signal isn't hidden.
 */
export async function landPreflight(task: Task, deps: WorktreeExecDeps = defaultExecDeps): Promise<LandPreflight> {
  const refuse = (pf: Omit<LandPreflight, "message">, refusal: LandRefusal): LandPreflight => {
    const refused = { ...pf, refusal }
    return { ...refused, message: landRefusalError(task, refused).message }
  }
  const branch = task.branch.trim()
  if (!branch) throw new Error(`landPreflight: task ${task.id} has no branch to land (never materialised)`)
  const { exec, dir } = baseRepoCtx(task.repo, deps)

  // Not `rev-parse --abbrev-ref HEAD`: with NO COMMITS it exits 128 and prints
  // `HEAD`, reading an unborn `main` as detached. `symbolic-ref` names an
  // unborn branch and fails only when HEAD isn't a branch. On failure the exit
  // code of a HEAD→commit probe splits a real detach from an unreadable repo
  // (structural, not a match on git's message).
  const headOut = await landGit(exec, dir, ["symbolic-ref", "--short", "HEAD"], { readOnly: true })
  const landedOn = headOut.stdout.trim()
  if (headOut.exitCode !== 0 || !landedOn) {
    const headCommit = await landGit(exec, dir, ["rev-parse", "--verify", "--quiet", "HEAD"], { readOnly: true })
    const detached = headCommit.exitCode === 0 && headCommit.stdout.trim().length > 0
    return refuse({ branch, landedOn: "", baseDir: dir }, detached ? "DETACHED_HEAD" : "UNREADABLE_BASE")
  }
  if (landedOn === branch) {
    return refuse({ branch, landedOn, baseDir: dir }, "SAME_BRANCH")
  }

  const baseDirty = await isDirty(exec, dir)
  const aheadOut = await landGit(exec, dir, ["rev-list", "--count", `${landedOn}..${branch}`], { readOnly: true })
  // Non-zero exit = a ref doesn't resolve → refuse. Exit 0 but unparseable =
  // assume work and let the merge speak. Conflating them made a renamed branch
  // look like a merge conflict.
  if (aheadOut.exitCode !== 0) {
    // An unborn base isn't a renamed task branch; `MissingRefError`'s
    // "re-point the task" can't fix it. Probed only on this failure path.
    const baseHead = await landGit(exec, dir, ["rev-parse", "--verify", "--quiet", "HEAD"], { readOnly: true })
    if (baseHead.exitCode !== 0 || !baseHead.stdout.trim()) {
      return refuse({ branch, landedOn, baseDirty, baseDir: dir }, "UNBORN_BASE")
    }
    return refuse({ branch, landedOn, baseDirty, baseDir: dir }, baseDirty ? "MAIN_CHECKOUT_DIRTY" : "MISSING_REF")
  }
  const parsed = Number.parseInt(aheadOut.stdout.trim(), 10)
  const base: LandPreflight = {
    branch,
    landedOn,
    baseDirty,
    baseDir: dir,
    ...(Number.isFinite(parsed) ? { ahead: parsed } : {}),
  }
  if (baseDirty) return refuse(base, "MAIN_CHECKOUT_DIRTY")
  // Only a counted zero refuses; unparseable lands like a positive count.
  if (base.ahead !== 0) return base

  const worktreePath = task.worktreePath.trim()
  if (worktreePath) {
    const manager = new GitWorktreeManager(deps)
    let dirty = false
    try {
      dirty = await manager.isDirty(worktreePath)
    } catch {
      dirty = false // worktree gone/unreadable → treat as the clean no-op case
    }
    if (dirty) {
      const wtExec = deps.execForPath(worktreePath)
      const files = parseDirtyPaths(
        (await landGit(wtExec, worktreePath, ["status", "--porcelain"], { readOnly: true })).stdout,
      )
      return refuse({ ...base, dirtyFiles: files }, "EMPTY_BRANCH_DIRTY_WORKTREE")
    }
  }
  return refuse(base, "EMPTY_BRANCH")
}

/** The single refusal → exception mapping, shared by confirm and merge. */
export function landRefusalError(task: Task, pf: LandPreflight & { readonly refusal: LandRefusal }): Error {
  switch (pf.refusal) {
    case "DETACHED_HEAD":
      return new Error(`landTask: base checkout at ${pf.baseDir} is in detached-HEAD state; check out a branch first`)
    case "UNREADABLE_BASE":
      return new Error(`landTask: could not read HEAD of the base checkout at ${pf.baseDir} — is it still a git repo?`)
    case "UNBORN_BASE":
      return new Error(
        `landTask: base checkout at ${pf.baseDir} is on '${pf.landedOn}' but has no commits yet, so there is nothing to merge '${pf.branch}' into; make the first commit there (or \`git merge --ff-only ${pf.branch}\`) and land again`,
      )
    case "SAME_BRANCH":
      return new Error(`landTask: base checkout is already on '${pf.branch}' — nothing to land onto`)
    case "MAIN_CHECKOUT_DIRTY":
      return new MainCheckoutDirtyError(task.repo, pf.baseDir)
    case "MISSING_REF":
      return new MissingRefError(pf.branch, pf.landedOn, pf.baseDir)
    case "EMPTY_BRANCH_DIRTY_WORKTREE":
      return new EmptyBranchDirtyWorktreeError(pf.branch, pf.landedOn, task.worktreePath.trim(), [
        ...(pf.dirtyFiles ?? []),
      ])
    case "EMPTY_BRANCH":
      return new EmptyBranchError(pf.branch, pf.landedOn)
  }
}
