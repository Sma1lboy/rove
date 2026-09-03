/**
 * How a repo path becomes the two identities the per-repo daemon stores need.
 *
 * Both stores key their records by the git COMMON dir, so every linked
 * worktree of one repository reads and writes the same record — that is what
 * makes an issue filed from a task's worktree visible from the main checkout.
 * The main worktree's path is the human-readable `repoRoot` shown alongside it.
 *
 * Shared because the issues and notes stores each grew a private copy that
 * then drifted (one fell back to `--show-toplevel` when `worktree list`
 * answered nothing, the other threw). The derivation is the same question;
 * the ANSWER to "no worktree line" is a per-store policy, so this returns
 * null and each store's own `resolveRepo` keeps deciding.
 */

import { execFile } from "node:child_process"
import { realpath } from "node:fs/promises"
import { isAbsolute, resolve } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

/** The repository's shared git dir, resolved absolute — the record key. */
export async function gitCommonDir(path: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", path, "rev-parse", "--git-common-dir"])
  const dir = stdout.trim()
  return realpath(isAbsolute(dir) ? dir : resolve(path, dir))
}

/**
 * The repository's MAIN worktree path, or null when `git worktree list`
 * printed no worktree line at all (the caller decides what that means).
 */
export async function gitMainWorktree(path: string): Promise<string | null> {
  const { stdout } = await execFileAsync("git", ["-C", path, "worktree", "list", "--porcelain"])
  const first = stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith("worktree "))
    ?.slice("worktree ".length)
    .trim()
  return first ? await realpath(first) : null
}
