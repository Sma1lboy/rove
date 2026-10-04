/**
 * What actually happened to a deleted task's BRANCH — local and remote.
 *
 * `status: "removed"` is the worktree's outcome, not the branch's: git
 * refuses branch deletes for ordinary reasons (unmerged work, a sibling
 * worktree holding it), and the caller needs to see that.
 *
 * GROUND TRUTH, not a callback: after the removal resolves, ask git what is
 * left — correct even if the deletion path changes shape. Where the branch
 * survives, the delete is RE-RUN once: it either converges or yields git's
 * own sentence about why not.
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
  /** git's own sentence about why it kept the branch; set only when `deleted`
   *  is false. Information, not an error — survival is recoverable. */
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
 * The remote this branch was pushed to (`branch.<name>.remote`, so a fork
 * branch is deleted on the fork). Falls back to `origin` for a never-pushed
 * branch, where the delete fails harmlessly and says so.
 */
function remoteFor(repo: string, branch: string): string {
  const configured = git(repo, ["config", "--get", `branch.${branch}.remote`])
  return configured.ok && configured.stdout.length > 0 ? configured.stdout : "origin"
}

function deleteRemoteBranch(repo: string, branch: string): NonNullable<BranchDeletionReport["remote"]> {
  const name = remoteFor(repo, branch)
  const push = git(repo, ["push", name, "--delete", branch], REMOTE_TIMEOUT_MS)
  if (push.ok) return { name, deleted: true }
  // ALREADY gone counts as deleted; check with ls-remote since git's
  // "remote ref does not exist" is localized.
  const remaining = git(repo, ["ls-remote", "--heads", name, branch], REMOTE_TIMEOUT_MS)
  if (remaining.ok && remaining.stdout.length === 0) return { name, deleted: true }
  return { name, deleted: false, error: push.stderr || "git push exited non-zero" }
}

/**
 * Read (and, for the remote, perform) the branch half of a task deletion.
 *
 * Call AFTER the worktree removal resolves: git refuses to delete a branch a
 * live worktree has checked out.
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
      // `-d`/`-D` mirrors the daemon's delete — never escalate past a safety
      // the caller didn't ask to bypass.
      const retry = git(repo, ["branch", opts.force ? "-D" : "-d", branch])
      deleted = retry.ok || !localBranchExists(repo, branch)
      if (!deleted) keptReason = retry.stderr || retry.stdout || "git branch refused the delete"
    }
  } else {
    // No local delete asked for: report what's there, not a requested deletion.
    deleted = !localBranchExists(repo, branch)
  }

  return {
    branch,
    deleted,
    ...(keptReason ? { keptReason } : {}),
    ...(opts.deleteRemote ? { remote: deleteRemoteBranch(repo, branch) } : {}),
  }
}
