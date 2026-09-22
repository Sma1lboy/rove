/**
 * Refuse a routine whose repo or base ref can't work at CREATE time, while the
 * user is there — otherwise every firing fails `skipped_unavailable` and a
 * `0 3 * * *` routine reports it tomorrow. Checked at save, not fire: a later
 * delete/rename still fails at 3am.
 *
 * Lives here, not in the CLI verb, because the TUI composer also calls
 * `automation.create`.
 */

import { execFile } from "node:child_process"
import { stat } from "node:fs/promises"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

/** `ssh://…` is a checkout on ANOTHER host: nothing local to probe, so pass it. */
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
 * Throw unless `ref` resolves to a commit in `repo`, as `git worktree add`
 * needs at every firing. A non-work-tree repo PASSES: on update the repo is
 * fixed, so failing would block correcting the base ref.
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
