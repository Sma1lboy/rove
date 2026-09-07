/**
 * One parse of `git status --porcelain` into the paths a refusal names.
 *
 * Landing and syncing both refuse on a dirty tree and both list the offending
 * files, so both had to strip the two-character `XY` status and its separating
 * space off every line — and they did it twice, with `sync-base.ts` asserting
 * "same shape as landing's `porcelainPaths`" while being strictly more careful:
 * it required a line long enough to HAVE a path and dropped empties afterwards,
 * where landing's `slice(3)` on a short line yielded `""` and rendered it to
 * the user as a filename. Real `git status --porcelain` always emits
 * `XY <path>` (≥4 chars), so the two agreed on every input git actually
 * produces — which is exactly why the drift survived: the comment was right in
 * practice and wrong in the letter. The careful version is the one kept.
 *
 * Deliberately NOT `lib/git-parsers.ts`'s `parsePorcelainRows`, which unquotes
 * C-escaped paths and resolves `R  old -> new` to the new path. That is the
 * better parser and these call sites should probably use it, but adopting it
 * changes the user-visible file lists on the `SYNC_WORKTREE_DIRTY` and
 * `EmptyBranchDirtyWorktreeError` paths — its own change, with its own tests.
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
 * Deliberately defined AS "{@link parseDirtyPaths} found something": the gate
 * and the message it prints must never disagree, and they did — three call
 * sites had three notions of empty (`stdout.length > 0`, `stdout.trim()`,
 * and this parse), so a stdout of `"\n"` read dirty to the worktree manager's
 * delete gate and clean to landing and syncing. A remote `ExecHost` is where
 * that trailing newline actually comes from.
 */
export function isDirtyOutput(stdout: string): boolean {
  return parseDirtyPaths(stdout).length > 0
}
