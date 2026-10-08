/**
 * Last `listFiles` result per worktree, so a task switch paints the previous
 * list at once and the refetch that follows commits only when it differs.
 * Bounded LRU: a large repo's list is a few MB.
 */

const MAX_ENTRIES = 4

const lists = new Map<string, string[]>()

export function cachedFileList(worktreePath: string): string[] | null {
  return lists.get(worktreePath) ?? null
}

export function rememberFileList(worktreePath: string, files: string[]): void {
  lists.delete(worktreePath)
  lists.set(worktreePath, files)
  while (lists.size > MAX_ENTRIES) {
    const oldest = lists.keys().next().value as string
    lists.delete(oldest)
  }
}
