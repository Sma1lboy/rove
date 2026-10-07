/**
 * One parse of `git status --porcelain` into the paths a refusal names.
 *
 * Shared by landing, syncing and the delete gate, which all refuse on a dirty
 * tree and list the files. Paths go through the shared porcelain parser, so a
 * C-quoted `"\347\254\224.md"` or `"a b.txt"` reads as the real filename and a
 * rename names its new path. Lines too short to hold a path are dropped, so an
 * empty string never renders as a filename.
 */

import { parsePorcelainRows } from "../lib/git-parsers.ts"

/** Paths from `git status --porcelain` output, unquoted, in `git status` order. */
export function parseDirtyPaths(stdout: string): string[] {
  return parsePorcelainRows(stdout)
    .filter((row) => (row.x + row.y).trim().length > 0)
    .map((row) => row.path)
    .filter((p) => p.length > 0)
}

/**
 * Whether `git status --porcelain` output means the tree is dirty.
 *
 * Defined AS "{@link parseDirtyPaths} found something" so the gate and its
 * message never disagree — e.g. a stdout of `"\n"` (from a remote `ExecHost`)
 * must read clean everywhere, including the worktree manager's delete gate.
 */
export function isDirtyOutput(stdout: string): boolean {
  return parseDirtyPaths(stdout).length > 0
}
