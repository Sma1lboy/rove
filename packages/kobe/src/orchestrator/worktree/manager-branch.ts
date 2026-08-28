/**
 * The BRANCH operations, split out of `manager.ts` (file-size cap).
 *
 * Existence probes, upstream lookup, delete and rename — the git-branch verbs
 * the manager exposes. They're orthogonal to worktree lifecycle (create /
 * remove / list) and share only the run-git primitive, so they live here as
 * free functions over a small {@link BranchDeps}, and the class methods stay
 * thin delegators. Same shape as `manager-list.ts`; no behaviour change.
 */

import type { ExecHost } from "../../exec/exec-host.ts"
import type { ExecCtx } from "./exec-deps.ts"
import { GitCommandError, type GitRunOpts, type GitRunResult } from "./git.ts"

/** The manager primitives the branch functions borrow. */
export interface BranchDeps {
  runGit(exec: ExecHost, args: readonly string[], opts: GitRunOpts): Promise<GitRunResult>
  /** ExecHost for a worktree path, absolute-path check bound in. */
  execAt(worktreePath: string): ExecHost
  /** The repo owning a worktree path, or null when it isn't one. */
  findRepoFor(exec: ExecHost, worktreePath: string): Promise<string | null>
}

/**
 * Whether `branch` exists in the repo at `ctx`. `show-ref --verify --quiet`
 * exits 0/1 cleanly without touching working tree state.
 */
export async function branchExists(deps: BranchDeps, ctx: ExecCtx, branch: string): Promise<boolean> {
  const out = await deps.runGit(ctx.exec, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
    cwd: ctx.dir,
    allowFail: true,
  })
  return out.exitCode === 0
}

/**
 * Delete a branch in `repo`. `git branch -d` (safe: refuses an unmerged
 * branch) unless `force`, which uses `-D`. Best-effort — a branch that's
 * checked out elsewhere, unmerged (without force), or already gone just
 * returns; the caller (task delete / land cleanup) treats it as non-fatal.
 */
export async function deleteBranchIn(
  deps: BranchDeps,
  exec: ExecHost,
  repo: string,
  branch: string,
  force: boolean,
): Promise<void> {
  if (!branch || branch === "HEAD") return
  await deps.runGit(exec, ["branch", force ? "-D" : "-d", branch], { cwd: repo, allowFail: true })
}

/**
 * Whether `branch` has a configured upstream (i.e. it tracks / was pushed to a
 * remote). Auto branch-follow refuses to touch such a branch — `branch -m`
 * would orphan the remote branch and break any open PR. Throws on git failure:
 * an unreadable probe is ambiguity, not "no".
 */
export async function branchHasUpstream(deps: BranchDeps, worktreePath: string, branch: string): Promise<boolean> {
  const out = await deps.runGit(
    deps.execAt(worktreePath),
    ["for-each-ref", "--format=%(upstream)", `refs/heads/${branch}`],
    {
      cwd: worktreePath,
    },
  )
  return out.stdout.trim().length > 0
}

/** Whether a local `refs/heads/<branch>` exists in the repo owning `worktreePath`. */
export async function hasLocalBranch(deps: BranchDeps, worktreePath: string, branch: string): Promise<boolean> {
  const out = await deps.runGit(
    deps.execAt(worktreePath),
    ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
    {
      cwd: worktreePath,
      allowFail: true,
    },
  )
  return out.exitCode === 0
}

/**
 * Rename a branch in-place. Used by `setBranch` and the follow-branch-to-title
 * flow when a placeholder-named task gets its first real title.
 *
 * git's `branch -m <old> <new>` updates HEAD on every worktree that was
 * checked out on `<old>` — the engine's session keeps streaming without
 * noticing. Idempotent: returns silently when `from === to`, and also when
 * `from` is already gone while `to` exists — the recorded `from` can be
 * stale (a retried call whose first attempt renamed but whose response was
 * lost, a concurrent rename, an out-of-band `git branch -m`; issue #44), and
 * branch refs are shared across worktrees, so old-gone + new-present IS the
 * requested end state. If `to` already exists alongside `from`, throws.
 */
export async function renameBranch(deps: BranchDeps, worktreePath: string, from: string, to: string): Promise<void> {
  const exec = deps.execAt(worktreePath)
  if (from === to) return
  const repo = await deps.findRepoFor(exec, worktreePath)
  if (!repo) throw new Error(`renameBranch(): ${worktreePath} is not a git worktree`)
  const out = await deps.runGit(exec, ["branch", "-m", from, to], { cwd: repo, allowFail: true })
  if (out.exitCode === 0) return
  const ctx: ExecCtx = { exec, dir: repo, remote: exec.isRemote }
  if (!(await branchExists(deps, ctx, from)) && (await branchExists(deps, ctx, to))) return
  throw new GitCommandError(["branch", "-m", from, to], repo, out)
}
