/**
 * Salvage: make a force-delete recoverable.
 *
 * `remove(path, { force: true })` runs `git worktree remove --force`, which
 * deletes uncommitted edits AND untracked files with no copy anywhere. Three
 * callers reach it without a fresh dirty check — the queued task deletion
 * (whose `force` was frozen a daemon restart ago), the scratch-shell teardown,
 * and the worktrees page's force retry on a row captured before the confirm.
 * Salvage runs first and writes what is about to be destroyed into the repo's
 * object database, so "gone" becomes "recoverable".
 *
 * Why not `git stash create`: it CANNOT capture untracked files. `-u` is
 * accepted and silently ignored (the resulting commit has two parents, no
 * untracked tree) — and a new file nobody has `git add`ed yet is exactly the
 * kind most easily lost. So the snapshot is built by hand:
 *
 *     GIT_INDEX_FILE=<throwaway> git add -A   → stages tracked edits + untracked
 *     git write-tree                          → a tree of the whole worktree
 *     git commit-tree <tree> -p HEAD          → a commit rooted at real history
 *     git update-ref refs/rove/salvage/<slug> → a named, gc-proof anchor
 *
 * `git add -A` honours `.gitignore`, so `node_modules/` and build output stay
 * out; only files a user could actually have authored are captured.
 *
 * The ref (not just the loose object) is the point: a dangling commit is
 * findable only via `git fsck` and expires with gc, while
 * `git for-each-ref refs/rove/salvage` lists every snapshot by branch and
 * timestamp — the two things a user who just lost work actually has.
 */

import type { ExecHost } from "../../exec/exec-host.ts"
import type { GitRunOpts, GitRunResult } from "./git.ts"

/** The git primitives salvage borrows from the manager. */
export interface SalvageDeps {
  runGit(exec: ExecHost, args: readonly string[], opts: GitRunOpts): Promise<GitRunResult>
}

/** A recorded snapshot: the ref a user recovers from, and the commit it names. */
export interface SalvageRecord {
  readonly ref: string
  readonly commit: string
}

/** `refs/rove/salvage/<branch>-<utc-stamp>` — a ref name git accepts, keyed by
 *  the two things a user remembers: which branch, and roughly when. */
function salvageRef(branch: string | null, now: Date): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z")
  const slug = (branch ?? "detached").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "")
  return `refs/rove/salvage/${slug || "detached"}-${stamp}`
}

/**
 * Snapshot everything in `worktreePath` that a force-remove would destroy.
 *
 * Returns null when there is nothing to save (clean worktree) or when the
 * snapshot could not be taken. NEVER throws: salvage is a safety net around
 * a delete the caller already asked for, so a failure here must not turn a
 * requested deletion into an error. A null return is the caller's cue to log
 * "no snapshot" rather than to abort.
 */
export async function salvageWorktree(
  deps: SalvageDeps,
  exec: ExecHost,
  worktreePath: string,
  now: Date = new Date(),
): Promise<SalvageRecord | null> {
  const git = (args: readonly string[]) => deps.runGit(exec, args, { cwd: worktreePath, allowFail: true })
  try {
    // Nothing uncommitted (tracked or untracked) → nothing a force-remove
    // could destroy that HEAD doesn't already hold.
    const status = await git(["status", "--porcelain"])
    if (status.exitCode !== 0 || status.stdout.trim().length === 0) return null

    // A throwaway index INSIDE the worktree's own git dir, so staging never
    // touches the real index and the file dies with the worktree either way.
    const indexPath = (await git(["rev-parse", "--git-path", "rove-salvage-index"])).stdout.trim()
    if (!indexPath) return null
    const withIndex = (args: readonly string[]) =>
      deps.runGit(exec, args, { cwd: worktreePath, allowFail: true, env: { GIT_INDEX_FILE: indexPath } })

    try {
      if ((await withIndex(["add", "-A"])).exitCode !== 0) return null
      const tree = (await withIndex(["write-tree"])).stdout.trim()
      if (!tree) return null

      // Parent the snapshot on HEAD so `git show <ref>` diffs against the
      // real history. An unborn branch has no HEAD — commit a root instead
      // of losing the files.
      const head = (await git(["rev-parse", "HEAD"])).stdout.trim()
      const branch = (await git(["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim()
      const message = `rove salvage: force-removed worktree ${worktreePath}`
      const commitArgs = head ? ["commit-tree", tree, "-p", head, "-m", message] : ["commit-tree", tree, "-m", message]
      const commit = (await withIndex(commitArgs)).stdout.trim()
      if (!commit) return null

      const ref = salvageRef(branch && branch !== "HEAD" ? branch : null, now)
      if ((await git(["update-ref", ref, commit])).exitCode !== 0) return null
      return { ref, commit }
    } finally {
      // The index file lives in `.git/worktrees/<name>/`, which the removal
      // prunes anyway; clearing it keeps a failed salvage from leaving debris
      // when the caller's remove then also fails. Plain `rm` (not `git rm`,
      // which only unstages TRACKED paths) through the exec seam so a remote
      // worktree cleans up over the same ssh connection.
      await exec.run(["rm", "-f", indexPath], { cwd: worktreePath }).catch(() => undefined)
    }
  } catch {
    return null
  }
}
