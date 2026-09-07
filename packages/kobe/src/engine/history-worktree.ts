import path from "node:path"

export function sameHistoryWorktree(recorded: string | undefined, worktree: string): boolean {
  if (!recorded || !worktree) return false
  const windows = [recorded, worktree].some((cwd) => /^[a-z]:[\\/]/i.test(cwd) || cwd.startsWith("\\\\"))
  const normalize = windows ? path.win32.normalize : path.posix.normalize
  return normalize(recorded) === normalize(worktree)
}
