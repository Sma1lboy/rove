/** `manager.ts`'s branch verbs (exists, upstream, delete, rename): orthogonal
 *  to worktree lifecycle, sharing only run-git via {@link BranchDeps}. */

import type { ExecHost } from "../../exec/exec-host.ts"
import { anchorBranchTip } from "./branch-anchor.ts"
import type { ExecCtx } from "./exec-deps.ts"
import { GitCommandError, type GitRunOpts, type GitRunResult } from "./git.ts"
import type { SalvageRecord } from "./salvage.ts"

export interface BranchDeps {
  runGit(exec: ExecHost, args: readonly string[], opts: GitRunOpts): Promise<GitRunResult>
  /** ExecHost for a worktree path, absolute-path check bound in. */
  execAt(worktreePath: string): ExecHost
  /** The repo owning a worktree path, or null when it isn't one. */
  findRepoFor(exec: ExecHost, worktreePath: string): Promise<string | null>
}

/** `show-ref --verify --quiet` exits 0/1 without touching the working tree. */
export async function branchExists(deps: BranchDeps, ctx: ExecCtx, branch: string): Promise<boolean> {
  const out = await deps.runGit(ctx.exec, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
    cwd: ctx.dir,
    allowFail: true,
    readOnly: true,
  })
  return out.exitCode === 0
}

/**
 * Best-effort (never fails a committed removal) but not silent: `deleted:
 * false` reports a refusal. `-d` refuses an unmerged branch (the usual
 * `delete --delete-branch` case); both spellings refuse a checked-out branch.
 */
export type BranchDeleteOutcome = { readonly deleted: true } | { readonly deleted: false; readonly reason: string }

/** `-d` unless `force` (`-D`). Never throws; refusals come back as outcomes. */
async function deleteBranchIn(
  deps: BranchDeps,
  exec: ExecHost,
  repo: string,
  branch: string,
  force: boolean,
): Promise<BranchDeleteOutcome> {
  if (!branch || branch === "HEAD") return { deleted: false, reason: "no branch to delete" }
  const out = await deps.runGit(exec, ["branch", force ? "-D" : "-d", branch], { cwd: repo, allowFail: true })
  if (out.exitCode === 0) return { deleted: true }
  // Re-probe instead of parsing stderr (localized): already gone IS the
  // requested end state.
  if (!(await branchExists(deps, { exec, dir: repo, remote: exec.isRemote }, branch))) return { deleted: true }
  return {
    deleted: false,
    reason: out.stderr.trim() || out.stdout.trim() || `git branch exited ${out.exitCode}`,
  }
}

/** With `force` (`-D`), anchor the tip first ({@link anchorBranchTip}; no-op
 *  when another ref reaches it). A failed anchor never fails the deletion. */
export async function deleteBranchAnchored(
  deps: BranchDeps,
  exec: ExecHost,
  repo: string,
  branch: string,
  opts: { readonly force: boolean; readonly onAnchor?: (record: SalvageRecord | null) => void },
): Promise<BranchDeleteOutcome> {
  if (opts.force) opts.onAnchor?.(await anchorBranchTip(deps, exec, repo, branch))
  return await deleteBranchIn(deps, exec, repo, branch, opts.force)
}

/** Auto branch-follow won't rename a branch with an upstream (would orphan the
 *  remote / PR). Throws on git failure: unreadable is ambiguity, not "no". */
export async function branchHasUpstream(deps: BranchDeps, worktreePath: string, branch: string): Promise<boolean> {
  const out = await deps.runGit(
    deps.execAt(worktreePath),
    ["for-each-ref", "--format=%(upstream)", `refs/heads/${branch}`],
    {
      cwd: worktreePath,
      readOnly: true,
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
      readOnly: true,
    },
  )
  return out.exitCode === 0
}

/**
 * `branch -m` updates HEAD on every worktree on `from`, so a running session
 * keeps streaming. Idempotent: returns when `from === to`, or when `from` is
 * gone and `to` exists (a stale `from` after a lost retry response, concurrent
 * or out-of-band rename — that IS the end state). Throws if both exist.
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
