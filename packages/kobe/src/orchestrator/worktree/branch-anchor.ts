/**
 * Anchor a branch tip before a delete that would make it unreachable.
 *
 * `git branch -D` deletes the branch ref AND its reflog. For a branch whose
 * commits are reachable from somewhere else — a `--no-ff` merge leaves them
 * parented under the merge commit — that is harmless. After a SQUASH land it
 * is not: the base gets one brand-new commit with no link back, so the
 * branch's own commits become reachable from nothing at all.
 *
 * The per-worktree reflog is not a backstop either. It lives in
 * `.git/worktrees/<slug>/logs/HEAD`, and `land --delete-branch` removes the
 * worktree first, so by the time `-D` runs both copies are already gone. What
 * is left is dangling objects: findable only by `git fsck --lost-found`, and
 * only until `gc.pruneExpire` (two weeks by default) collects them.
 *
 * So: before deleting, write the tip into `refs/rove/salvage/…` — the same
 * namespace {@link salvageWorktree} uses, so one `for-each-ref` lists every
 * kind of rescued work. Skipped when the commits are already reachable from
 * another ref, which is the ordinary `--strategy merge` case: an anchor there
 * would be noise nobody ever needs.
 */

import type { ExecHost } from "../../exec/exec-host.ts"
import type { GitRunOpts, GitRunResult } from "./git.ts"
import { type SalvageRecord, salvageRef } from "./salvage.ts"

/** The git primitives the anchor borrows from the manager. */
export interface BranchAnchorDeps {
  runGit(exec: ExecHost, args: readonly string[], opts: GitRunOpts): Promise<GitRunResult>
}

/**
 * Write `refs/rove/salvage/<branch>-<stamp>` at `branch`'s tip when nothing
 * else would keep it reachable.
 *
 * Returns null when no anchor was needed (the tip is already reachable from
 * another ref) or when one could not be written. NEVER throws: this guards a
 * deletion the caller has already asked for, so a failure here must not turn
 * that deletion into an error — the same contract as {@link salvageWorktree}.
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

    // Any ref OTHER than the branch itself containing the tip means the
    // commits survive the delete on their own — the `--no-ff` merge case.
    // `--contains` walks history, so a merge commit on the base branch counts.
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
    // Always complete: an anchor points at a commit that already exists, so
    // there is no staging step that could drop a path.
    return { ref, commit: tip, uncaptured: [] }
  } catch {
    return null
  }
}
