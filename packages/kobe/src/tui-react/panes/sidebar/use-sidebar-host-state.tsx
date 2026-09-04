/**
 * Sidebar-host state: the global sort pref (kv-persisted, fanned out by the
 * daemon's ui-prefs watcher) and the move-mode toggle behind the sidebar's
 * local-merge/move request. The host's toast helpers used to live here too;
 * they are `use-host-notifiers.ts` now, because every one of the host's
 * notifiers wants the same `selectedId` and only some of them are
 * sidebar-adjacent.
 *
 * KNOWN DRIFT (deliberate, not hidden here): the Tasks pane FOLLOWS live
 * `ui-prefs` pushes for sortMode/projectFilter, the workspace host does
 * not. Those follow effects stay in the hosts, driving the raw
 * `setSortMode` returned here.
 */

import { useState } from "react"
import type { TaskSortMode } from "../../../tui/panes/sidebar/groups"
import type { Task } from "../../../types/task.ts"
import type { KVContext } from "../../context/kv"

export interface SidebarHostState {
  readonly sortMode: TaskSortMode
  /** Raw state setter (no kv write) — for hosts following ui-prefs pushes. */
  readonly setSortMode: (next: TaskSortMode) => void
  /**
   * Flip the sort: apply locally for instant feedback, then persist — the kv
   * write lands in state.json and the daemon's ui-prefs watcher fans it out
   * to every other session's Sidebar host (global sort).
   */
  readonly toggleSortMode: () => void
  readonly moveMode: boolean
  readonly setMoveMode: (next: boolean) => void
  /**
   * The Sidebar's move-mode request (`shift+m`): select a row and toggle
   * move mode. The tree then routes j/k by the cursor row's LEVEL: a tab
   * moves within its task, a task within its repo group, and a `main` row
   * drags its whole project.
   */
  readonly onLocalMergeRequest: (id: string) => void
}

export function useSidebarHostState(args: {
  readonly kv: KVContext
  readonly tasks: readonly Task[]
  readonly setSelectedId: (id: string) => void
}): SidebarHostState {
  const { kv, tasks, setSelectedId } = args

  // Sort mode is a GLOBAL pref, fanned out like theme/appearance: the toggle
  // writes `activeSortMode` to state.json and the daemon's ui-prefs watcher
  // pushes it on the `ui-prefs` channel. Seed from the persisted value so a
  // freshly-spawned host opens in the user's last sort.
  const [sortMode, setSortMode] = useState<TaskSortMode>(kv.get("activeSortMode") === "recent" ? "recent" : "default")
  const toggleSortMode = (): void => {
    const next: TaskSortMode = sortMode === "default" ? "recent" : "default"
    setSortMode(next)
    kv.set("activeSortMode", next)
  }

  const [moveMode, setMoveMode] = useState(false)
  const onLocalMergeRequest = (id: string): void => {
    const task = tasks.find((t) => t.id === id)
    if (!task) return
    setSelectedId(id)
    setMoveMode((cur) => !cur)
  }

  return { sortMode, setSortMode, toggleSortMode, moveMode, setMoveMode, onLocalMergeRequest }
}
