/**
 * What actually happened to a deleted task's BRANCH — local and remote.
 *
 * `delete --delete-branch` used to answer only `status: "removed"`, which is
 * the worktree's outcome, not the branch's. git refuses a branch delete for
 * ordinary reasons (unmerged work, a sibling worktree still holding it) and
 * the refusal reached daemon.log and nowhere a caller could read it — so a
 * cleanup loop closing ten tasks could not tell nine deletions from ten. The
 * remote half was worse: nothing ever pushed a delete, so a merged branch
 * kept its origin copy forever and the reply said `removed`.
 *
 * The reads here are GROUND TRUTH rather than a callback: after the daemon's
 * removal resolves, this asks git what is left. That is the answer a caller
 * wanted anyway, and it stays correct if the deletion path ever changes shape.
 *
 * Where git still has the branch, the delete is RE-RUN — once — for its
 * reason. That is not a probe pretending to be idempotent: the caller asked
 * for the branch to be gone, the first attempt did not manage it, and a
 * second attempt either converges on what was asked or produces git's own
 * sentence about why it cannot. Both outcomes are reported honestly.
 */

import { spawnSync } from "node:child_process"
import { readOnlyGitProcessEnv } from "../../lib/git-env.ts"

/** A remote delete is a network round-trip; bound it so a stalled auth
 *  prompt or an unreachable host cannot hang a cleanup script forever. */
const REMOTE_TIMEOUT_MS = 30_000

/** What became of the branch a `delete` was asked to remove. */
export interface BranchDeletionReport {
  /** The branch name the task held (empty-string branches are never reported). */
  readonly branch: string
  /** Whether `refs/heads/<branch>` is gone from the repo. */
  readonly deleted: boolean
  /** git's own sentence about why it kept the branch. Set only when
   *  `deleted` is false — the branch surviving is the recoverable half, so
   *  this is information, not an error. */
  readonly keptReason?: string
  /** Present only when `--delete-remote` was asked for. */
  readonly remote?: {
    /** The remote the delete was pushed to (the branch's own, else `origin`). */
    readonly name: string
    readonly deleted: boolean
    /** git's stderr when the push failed. */
    readonly error?: string
  }
}

interface GitResult {
  readonly ok: boolean
  readonly stdout: string
  readonly stderr: string
}

function git(cwd: string, args: readonly string[], timeoutMs?: number): GitResult {
  try {
    const out = spawnSync("git", [...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: readOnlyGitProcessEnv(),
      ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }),
    })
    return {
      ok: out.status === 0,
      stdout: (out.stdout ?? "").trim(),
      // A `timeout` kill leaves status null and stderr empty; say so rather
      // than reporting a blank reason.
      stderr: (out.stderr ?? "").trim() || (out.status === null ? `git ${args[0]} did not finish` : ""),
    }
  } catch (err) {
    return { ok: false, stdout: "", stderr: err instanceof Error ? err.message : String(err) }
  }
}

function localBranchExists(repo: string, branch: string): boolean {
  return git(repo, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).ok
}

/**
 * The remote this branch was pushed to. `branch.<name>.remote` is what git
 * itself would use, so a branch tracking a fork is deleted on the fork rather
 * than on whatever `origin` happens to be. Falls back to `origin` for a
 * branch that was never pushed — where the delete then fails harmlessly and
 * says so.
 */
function remoteFor(repo: string, branch: string): string {
  const configured = git(repo, ["config", "--get", `branch.${branch}.remote`])
  return configured.ok && configured.stdout.length > 0 ? configured.stdout : "origin"
}

function deleteRemoteBranch(repo: string, branch: string): NonNullable<BranchDeletionReport["remote"]> {
  const name = remoteFor(repo, branch)
  const push = git(repo, ["push", name, "--delete", branch], REMOTE_TIMEOUT_MS)
  if (push.ok) return { name, deleted: true }
  // Same convergence rule as the local half: a remote branch that is ALREADY
  // gone is the end state the caller asked for, and git spells that refusal
  // ("remote ref does not exist") in whatever language it is running in.
  const remaining = git(repo, ["ls-remote", "--heads", name, branch], REMOTE_TIMEOUT_MS)
  if (remaining.ok && remaining.stdout.length === 0) return { name, deleted: true }
  return { name, deleted: false, error: push.stderr || "git push exited non-zero" }
}

/**
 * Read (and, for the remote, perform) the branch half of a task deletion.
 *
 * Called AFTER the daemon's worktree removal resolves: git refuses to delete
 * a branch a live worktree still has checked out, so asking earlier would
 * report a refusal the deletion was about to make moot.
 */
export function reportBranchDeletion(
  repo: string,
  branch: string,
  opts: { readonly deleteBranch: boolean; readonly force: boolean; readonly deleteRemote: boolean },
): BranchDeletionReport | undefined {
  if (!branch || (!opts.deleteBranch && !opts.deleteRemote)) return undefined

  let deleted = true
  let keptReason: string | undefined
  if (opts.deleteBranch) {
    if (localBranchExists(repo, branch)) {
      // `-d` / `-D` mirrors what the daemon's own delete used, so this
      // converges on the same answer rather than escalating past a safety
      // the caller did not ask to bypass.
      const retry = git(repo, ["branch", opts.force ? "-D" : "-d", branch])
      deleted = retry.ok || !localBranchExists(repo, branch)
      if (!deleted) keptReason = retry.stderr || retry.stdout || "git branch refused the delete"
    }
  } else {
    // No local delete was asked for, so the branch is expected to survive —
    // say that plainly instead of reporting a deletion nobody requested.
    deleted = !localBranchExists(repo, branch)
  }

  return {
    branch,
    deleted,
    ...(keptReason ? { keptReason } : {}),
    ...(opts.deleteRemote ? { remote: deleteRemoteBranch(repo, branch) } : {}),
  }
}
