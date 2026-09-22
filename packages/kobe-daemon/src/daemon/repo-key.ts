/**
 * How a repo path becomes the two identities the per-repo daemon stores need.
 *
 * Records key by the git COMMON dir, so every linked worktree of a repo shares
 * one record (an issue filed from a task worktree shows in the main checkout).
 * The main worktree path is the human-readable `repoRoot`.
 */

import { execFile } from "node:child_process"
import { realpath, stat } from "node:fs/promises"
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

/** The working tree's top level — the fallback root when no worktree line exists. */
export async function gitTopLevel(path: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", path, "rev-parse", "--show-toplevel"])
  return stdout.trim()
}

/**
 * Validate the path is a directory, then derive both identities. `repoRoot`
 * is null exactly when `git worktree list` printed no worktree line; the
 * policy stays per store (issues falls back to {@link gitTopLevel}, notes
 * refuses).
 */
export async function resolveRepoRoot(raw: string): Promise<{ repoRoot: string | null; repoKey: string }> {
  const absolute = resolve(raw)
  const s = await stat(absolute).catch(() => null)
  if (!s?.isDirectory()) throw new Error("repoRoot does not exist")
  const [repoRoot, repoKey] = await Promise.all([gitMainWorktree(absolute), gitCommonDir(absolute)])
  return { repoRoot, repoKey }
}
