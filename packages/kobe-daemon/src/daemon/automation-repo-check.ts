/**
 * Refuse a routine whose repo or base ref cannot work — at CREATE time, while
 * the user is present to fix it.
 *
 * Same reasoning as `requireSchedule` in `handlers-automations.ts`: an
 * unusable value that is only discovered by watching the schedule not run is
 * the expensive kind of wrong. A missing repo or an unresolvable base ref
 * fails identically at every firing (`skipped_unavailable`, from
 * `git worktree add`), and for a `0 3 * * *` routine the user finds out
 * tomorrow morning — a day after the moment they could have typed the right
 * path.
 *
 * What this is NOT: a guarantee. The repo is checked when the routine is
 * saved, not when it fires; a repo deleted or a branch renamed afterwards
 * still fails at 3am. Catching the typo the user just made is the whole claim.
 *
 * Deliberately here rather than in the CLI verb: the TUI composer calls
 * `automation.create` too, and a check in one caller only covers that caller.
 */

import { execFile } from "node:child_process"
import { stat } from "node:fs/promises"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

/** A remote project key (`ssh://…`) names a checkout on ANOTHER host, so there
 *  is nothing local to probe — passing it through is the only correct answer,
 *  and rejecting valid input is worse than the gap it would close. */
function isProbeable(repo: string): boolean {
  return !repo.startsWith("ssh://")
}

async function isGitWorkTree(repo: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repo, "rev-parse", "--is-inside-work-tree"])
    return stdout.trim() === "true"
  } catch {
    return false
  }
}

/** Throw unless `repo` is a directory holding a git work tree. */
export async function assertRoutineRepo(repo: string): Promise<void> {
  if (!isProbeable(repo)) return
  const entry = await stat(repo).catch(() => null)
  if (!entry?.isDirectory()) throw new Error(`repo does not exist: ${repo}`)
  if (!(await isGitWorkTree(repo))) throw new Error(`not a git repository: ${repo}`)
}

/**
 * Throw unless `ref` resolves to a commit in `repo` — the same question
 * `git worktree add -b <branch> <ref>` asks at every firing.
 *
 * A repo that is not a probeable work tree is a PASS, not a failure: on the
 * update path the repo cannot be changed, so failing here would make a routine
 * with a bad repo also unable to accept a corrected base ref, and the message
 * would name a problem the user was not editing.
 */
export async function assertRoutineBaseRef(repo: string, ref: string): Promise<void> {
  if (!ref || !isProbeable(repo)) return
  if (!(await isGitWorkTree(repo))) return
  try {
    await execFileAsync("git", ["-C", repo, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`])
  } catch {
    throw new Error(`base branch does not resolve in ${repo}: ${ref}`)
  }
}
