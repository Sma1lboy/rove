/**
 * The READ half of landing: every question `landTask` answers before it writes
 * anything — which branch the base checkout is on, how many commits the task
 * branch is ahead, whether the base is dirty, and whether any of that refuses
 * the land outright.
 *
 * Split out of `land.ts` because the answers are useful before the merge, not
 * only during it. `docs/WORKTREES.md` and `docs/ORCHESTRATION.md` both open
 * their land instructions with "check the base checkout is on the branch you
 * mean, first", and until this existed the only way to check was a shell. Now
 * the confirm dialog names the destination and the commit count, `rove api
 * land --dry-run` returns the same object, and `landTask` calls the same
 * function — so "may this land" has exactly one implementation and the confirm
 * cannot drift from the merge.
 *
 * The low-level git runner lives here rather than in `land.ts` because every
 * probe below needs it and the merge path imports it back; a third module for
 * four lines of `exec.run` would be a seam that names nothing.
 */

import type { ExecHost } from "../exec/exec-host.ts"
import { READ_ONLY_GIT_ENV } from "../lib/git-env.ts"
import type { Task } from "../types/task.ts"
import { EmptyBranchDirtyWorktreeError, EmptyBranchError, MainCheckoutDirtyError, MissingRefError } from "./errors.ts"
import { type WorktreeExecDeps, defaultExecDeps } from "./worktree/exec-deps.ts"
import { GitWorktreeManager } from "./worktree/manager.ts"

/**
 * Why a land cannot proceed. Each maps 1:1 to the error `landTask` throws (see
 * {@link landRefusalError}); the wire form is the string, so a caller that only
 * has JSON — `rove api land --dry-run`, an agent coordinator — can branch on it
 * without parsing an error message.
 */
export type LandRefusal =
  | "DETACHED_HEAD"
  | "SAME_BRANCH"
  | "MAIN_CHECKOUT_DIRTY"
  | "MISSING_REF"
  | "EMPTY_BRANCH"
  | "EMPTY_BRANCH_DIRTY_WORKTREE"

export interface LandPreflight {
  /** The task's branch — the merge source. */
  readonly branch: string
  /** The base checkout's current branch: the merge DESTINATION. Empty string
   *  only in the detached-HEAD refusal, where there is no branch to name. */
  readonly landedOn: string
  /**
   * Commits on `branch` that `landedOn` does not have. Absent — never a
   * fabricated zero — when git could not count them: a detached base checkout,
   * a ref that no longer resolves, or `rev-list` output we cannot parse.
   */
  readonly ahead?: number
  /** Whether the base checkout has uncommitted or untracked changes. Absent
   *  when the branch checks refused before it was worth asking. */
  readonly baseDirty?: boolean
  /** Set when the land is refused. Absent means it may proceed. */
  readonly refusal?: LandRefusal
  /** Uncommitted paths in the task's own worktree — only ever set alongside
   *  `EMPTY_BRANCH_DIRTY_WORKTREE`, which is the refusal that lists them. */
  readonly dirtyFiles?: readonly string[]
  /**
   * The refusal rendered as the exact message `landTask` would have thrown.
   * Carried on the wire so a caller that never runs the land — the TUI's
   * confirm, `land --dry-run` — reports the SAME words as the land, instead of
   * re-deriving them from the code and drifting.
   */
  readonly message?: string
  /** The base repo's working dir (a remote basePath, or the repo itself). */
  readonly baseDir: string
}

/** Resolve the git working dir + ExecHost for the base repo — local path or remote basePath. */
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
  // Read-only probes (status/diff/rev-parse/rev-list) run lock-free per
  // READ_ONLY_GIT_ENV — land inspects worktrees an engine may be
  // committing in right now. Writes (merge/abort/reset/commit) never set
  // readOnly: they genuinely need `.git/index.lock`.
  //
  // `stderr` is carried, not dropped: when a write fails, git's own message is
  // the only thing that says WHY (a hook, a signing key, an unset user.email),
  // and guessing at it is what produced this file's two worst error reports.
  const r = await exec.run(["git", ...args], { cwd: dir, env: opts?.readOnly ? READ_ONLY_GIT_ENV : undefined })
  return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }
}

/** `git status --porcelain` non-empty in `dir` (untracked counts). */
export async function isDirty(exec: ExecHost, dir: string): Promise<boolean> {
  return (await landGit(exec, dir, ["status", "--porcelain"], { readOnly: true })).stdout.trim().length > 0
}

/** Uncommitted/untracked paths from `git status --porcelain` output (strip the XY prefix). */
export function porcelainPaths(stdout: string): string[] {
  return stdout
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => l.slice(3).trim())
}

/**
 * Probe whether `task`'s branch can land, without touching anything.
 *
 * Refusal precedence matches the order `landTask` used to check inline —
 * detached HEAD, base already on this branch, dirty base, unresolvable ref,
 * empty branch — so moving the checks here changes which error a caller sees
 * for nothing. The COUNTS are gathered regardless of the refusal, because they
 * are free reads and a dry run that says "refused, and by the way you are 3
 * commits ahead" is more use than one that says only "refused".
 *
 * The zero-commit case is the "worker reported success and delivered nothing"
 * catch, and it splits in two: a dirty worktree means the work exists but was
 * never committed ({@link EmptyBranchDirtyWorktreeError}, which lists the
 * files); a clean or unreadable one is a genuine no-op ({@link
 * EmptyBranchError}). Ambiguity falls to the clean case — it must not hide the
 * no-op signal.
 */
export async function landPreflight(task: Task, deps: WorktreeExecDeps = defaultExecDeps): Promise<LandPreflight> {
  const refuse = (pf: Omit<LandPreflight, "message">, refusal: LandRefusal): LandPreflight => {
    const refused = { ...pf, refusal }
    return { ...refused, message: landRefusalError(task, refused).message }
  }
  const branch = task.branch.trim()
  if (!branch) throw new Error(`landPreflight: task ${task.id} has no branch to land (never materialised)`)
  const { exec, dir } = baseRepoCtx(task.repo, deps)

  const headOut = await landGit(exec, dir, ["rev-parse", "--abbrev-ref", "HEAD"], { readOnly: true })
  const landedOn = headOut.stdout.trim()
  if (!landedOn || landedOn === "HEAD") {
    return refuse({ branch, landedOn: "", baseDir: dir }, "DETACHED_HEAD")
  }
  if (landedOn === branch) {
    return refuse({ branch, landedOn, baseDir: dir }, "SAME_BRANCH")
  }

  const baseDirty = await isDirty(exec, dir)
  const aheadOut = await landGit(exec, dir, ["rev-list", "--count", `${landedOn}..${branch}`], { readOnly: true })
  // Exit code first, and it is NOT the same question as an unparseable count:
  // non-zero means git never counted (the ref does not resolve) → refuse the
  // land; exit 0 with output we cannot parse means git counted and we failed to
  // read it, where assuming "has work" and letting the merge speak is the safe
  // fallback. Collapsing the two is what made a renamed branch look like a
  // merge conflict.
  if (aheadOut.exitCode !== 0) {
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
  // Unparseable (`ahead` absent) lands with the merge as the arbiter, same as
  // a positive count — only a counted zero is a refusal.
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
      const files = porcelainPaths(
        (await landGit(wtExec, worktreePath, ["status", "--porcelain"], { readOnly: true })).stdout,
      )
      return refuse({ ...base, dirtyFiles: files }, "EMPTY_BRANCH_DIRTY_WORKTREE")
    }
  }
  return refuse(base, "EMPTY_BRANCH")
}

/**
 * The error a refused preflight throws when a caller wanted the land, not the
 * report. Keeping the mapping here rather than in `landTask` is what lets the
 * confirm dialog and the merge disagree about NOTHING: both read the same
 * `refusal`, and only this function decides what it is called in an exception.
 */
export function landRefusalError(task: Task, pf: LandPreflight & { readonly refusal: LandRefusal }): Error {
  switch (pf.refusal) {
    case "DETACHED_HEAD":
      return new Error(`landTask: base checkout at ${pf.baseDir} is in detached-HEAD state; check out a branch first`)
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
