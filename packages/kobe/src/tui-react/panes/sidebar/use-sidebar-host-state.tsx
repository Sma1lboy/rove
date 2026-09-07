/**
 * Sidebar-host state: the global sort pref (kv-persisted, fanned out by the
 * daemon's ui-prefs watcher) and the move-mode toggle behind the sidebar's
 * local-merge/move request. The host's toast helpers used to live here too;
 * they are `use-host-notifiers.ts` now, because every one of the host's
 * notifiers wants the same `selectedId` and only some of them are
 * sidebar-adjacent.
 *
 * KNOWN GAP — cross-session sort no longer arrives. The daemon still computes
 * `sortMode` from `activeSortMode` and pushes it on the `ui-prefs` channel
 * (`daemon/ui-prefs-watcher.ts`), and the client still parses it into
 * `UiPrefsPayload` (`client/remote-orchestrator-payloads.ts`) — but NOTHING
 * applies it. `host-boot.tsx`'s `UiPrefsSync` routes each push through
 * `applyUiPrefs`, whose snapshot type carries theme / transparentBackground /
 * focusAccent only, so `sortMode` and `projectFilter` are parsed and dropped.
 *
 * This is a removal, not an omission: the follow effect lived in the tmux
 * Tasks pane (`tui-react/tasks-pane/host.tsx`, "Sort mode + project filter
 * ride the SAME `ui-prefs` channel but are pane-state, so this pane follows
 * them here") and went with that pane in "Remove tmux and make PureTUI the
 * only runtime" (#313). The workspace host is the only host left and never had
 * one, so a sort toggle is now local to the session that made it while the
 * write, the push and the parse all still happen.
 *
 * `setSortMode` below is therefore kept deliberately: it is the raw setter
 * (kv-write-free, so it cannot echo) that a restored follow effect needs, and
 * deleting it would remove the seam along with the evidence. Restoring the
 * behaviour is a product decision, not cleanup — it is a live cross-session
 * change that nobody has asked for since #313.
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

/**
 * The order `t` walks. `default` (the orchestrator's own order) is first so
 * one extra press from anywhere still lands back on the resting sort.
 */
const SORT_MODE_CYCLE: readonly TaskSortMode[] = ["default", "recent", "attention"]

/** A persisted value this build doesn't know reads as the resting sort — the
 *  stored string is shared with older/newer builds through `state.json`. */
function readSortMode(stored: unknown): TaskSortMode {
  return SORT_MODE_CYCLE.find((mode) => mode === stored) ?? "default"
}

export function useSidebarHostState(args: {
  readonly kv: KVContext
  readonly tasks: readonly Task[]
  readonly setSelectedId: (id: string) => void
}): SidebarHostState {
  const { kv, tasks, setSelectedId } = args

  // Sort mode is PERSISTED globally: the toggle writes `activeSortMode` to
  // state.json and the daemon's ui-prefs watcher pushes it on the `ui-prefs`
  // channel. Seeding from the persisted value is what makes it global today —
  // a freshly-spawned host opens in the user's last sort. The live push is NOT
  // applied by any host; see the KNOWN GAP at the top of this file.
  const [sortMode, setSortMode] = useState<TaskSortMode>(() => readSortMode(kv.get("activeSortMode")))
  const toggleSortMode = (): void => {
    const next = SORT_MODE_CYCLE[(SORT_MODE_CYCLE.indexOf(sortMode) + 1) % SORT_MODE_CYCLE.length] ?? "default"
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
