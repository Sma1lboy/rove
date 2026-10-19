/**
 * Last `listFiles` result per worktree, so a task switch paints the previous
 * list at once and the refetch that follows commits only when it differs.
 * Bounded LRU: a large repo's list is a few MB.
 *
 * Each entry keeps the worktree's recursive watch alive (shared with the
 * pane's own). A list fetched while that watch was settled and followed by no
 * event is fresh: switching back to it needs no `git ls-files`.
 */

import { readRoveEnv } from "@sma1lboy/rove-daemon/compat-env"
import { execHostForWorktreePath } from "../../../exec/resolve.ts"
import { type WorktreeEvents, subscribeWorktreeEvents } from "./pane-core.ts"

const MAX_ENTRIES = 4

/** macOS FSEvents arms asynchronously; a fetch this soon after arming may have missed a write. */
const ARM_SETTLE_MS = 1_000

type Entry = {
  files: string[] | null
  fresh: boolean
  /** Bumped on every relevant event; a fetch is fresh only if none landed while it ran. */
  gen: number
  events: WorktreeEvents | null
}

/** Taken before a fetch starts; hand it back to {@link rememberFileList}. */
export type FileListFetch = { readonly gen: number; readonly watched: boolean }

const entries = new Map<string, Entry>()

function touch(worktreePath: string): Entry {
  let entry = entries.get(worktreePath)
  if (entry) {
    entries.delete(worktreePath)
  } else {
    const created: Entry = { files: null, fresh: false, gen: 0, events: null }
    const watchable = readRoveEnv("FILETREE_WATCH") !== "0" && !execHostForWorktreePath(worktreePath).isRemote
    if (watchable) {
      created.events = subscribeWorktreeEvents(worktreePath, () => {
        created.gen++
        created.fresh = false
      })
    }
    entry = created
  }
  entries.set(worktreePath, entry)
  while (entries.size > MAX_ENTRIES) {
    const [oldest, evicted] = entries.entries().next().value as [string, Entry]
    entries.delete(oldest)
    evicted.events?.dispose()
  }
  return entry
}

export function cachedFileList(worktreePath: string): string[] | null {
  return entries.get(worktreePath)?.files ?? null
}

/** The cached list when no file event has landed since it was fetched, else null. */
export function freshFileList(worktreePath: string): string[] | null {
  const entry = entries.get(worktreePath)
  return entry?.fresh ? entry.files : null
}

export function beginFileListFetch(worktreePath: string): FileListFetch {
  const entry = touch(worktreePath)
  const armedAt = entry.events?.armedAt ?? null
  return { gen: entry.gen, watched: armedAt != null && Date.now() - armedAt >= ARM_SETTLE_MS }
}

export function rememberFileList(worktreePath: string, files: string[], fetch: FileListFetch): void {
  const entry = touch(worktreePath)
  entry.files = files
  entry.fresh = fetch.watched && entry.gen === fetch.gen && entry.events?.armedAt != null
}
