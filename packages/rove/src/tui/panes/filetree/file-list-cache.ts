/** Last listing for immediate paint while switching worktrees revalidates with Git. */
const MAX_ENTRIES = 4
const lists = new Map<string, string[]>()

export function cachedFileList(worktreePath: string): string[] | null {
  return lists.get(worktreePath) ?? null
}

export function rememberFileList(worktreePath: string, files: string[]): void {
  lists.delete(worktreePath)
  lists.set(worktreePath, files)
  while (lists.size > MAX_ENTRIES) {
    const oldest = lists.keys().next().value
    if (oldest != null) lists.delete(oldest)
  }
}
