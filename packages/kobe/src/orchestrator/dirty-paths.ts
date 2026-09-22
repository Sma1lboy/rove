/**
 * One parse of `git status --porcelain` into the paths a refusal names.
 *
 * Shared by landing and syncing, which both refuse on a dirty tree and list the
 * files. Lines too short to hold a path (`XY <path>` is ≥4 chars) are dropped,
 * so an empty string never renders as a filename.
 *
 * Deliberately NOT `lib/git-parsers.ts`'s `parsePorcelainRows` (unquotes
 * C-escaped paths, resolves `R  old -> new`): the better parser, but adopting
 * it changes the user-visible lists on `SYNC_WORKTREE_DIRTY` and
 * `EmptyBranchDirtyWorktreeError` — its own change, with its own tests.
 */

/** Paths from `git status --porcelain` output, with the `XY ` prefix stripped. */
export function parseDirtyPaths(stdout: string): string[] {
  return stdout
    .split("\n")
    .filter((line) => line.length > 3)
    .map((line) => line.slice(3).trim())
    .filter((line) => line.length > 0)
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
