/**
 * `git branch -D` deletes the ref AND its reflog. After a SQUASH land the base
 * has no link back, and `land --delete-branch` already removed the worktree
 * (whose `.git/worktrees/<slug>/logs/HEAD` was the other reflog), so the
 * commits dangle: `git fsck --lost-found` only, until `gc.pruneExpire` (two
 * weeks by default). So write the tip into `refs/rove/salvage/…` first — same
 * namespace as {@link salvageWorktree}, one `for-each-ref` lists all rescued
 * work. Skipped when another ref reaches the tip (the `--no-ff` merge case).
 */

import type { ExecHost } from "../../exec/exec-host.ts"
import type { GitRunOpts, GitRunResult } from "./git.ts"
import { type SalvageRecord, salvageRef } from "./salvage.ts"

export interface BranchAnchorDeps {
  runGit(exec: ExecHost, args: readonly string[], opts: GitRunOpts): Promise<GitRunResult>
}

/**
 * Writes `refs/rove/salvage/<branch>-<stamp>`. Null when not needed or not
 * writable. NEVER throws (like {@link salvageWorktree}): it guards a deletion
 * already asked for and must not turn it into an error.
 */
export async function anchorBranchTip(
  deps: BranchAnchorDeps,
  exec: ExecHost,
  repo: string,
  branch: string,
  now: Date = new Date(),
): Promise<SalvageRecord | null> {
  if (!branch || branch === "HEAD") return null
  const git = (args: readonly string[]) => deps.runGit(exec, args, { cwd: repo, allowFail: true })
  try {
    const tipOut = await git(["rev-parse", "--verify", `refs/heads/${branch}`])
    const tip = tipOut.stdout.trim()
    if (tipOut.exitCode !== 0 || !tip) return null

    // Another ref containing the tip keeps the commits alive; `--contains`
    // walks history, so a merge commit on the base counts.
    const holders = await git(["for-each-ref", "--contains", tip, "--format=%(refname)"])
    if (holders.exitCode === 0) {
      const others = holders.stdout
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && l !== `refs/heads/${branch}`)
      if (others.length > 0) return null
    }

    const ref = salvageRef(branch, now)
    if ((await git(["update-ref", ref, tip])).exitCode !== 0) return null
    // Always complete: no staging step that could drop a path.
    return { ref, commit: tip, uncaptured: [] }
  } catch {
    return null
  }
}
