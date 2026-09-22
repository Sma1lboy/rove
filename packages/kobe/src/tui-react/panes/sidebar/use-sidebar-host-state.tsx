/**
 * Sidebar-host state: the global sort pref (kv-persisted) and the move-mode
 * toggle behind the sidebar's local-merge/move request.
 *
 * KNOWN GAP — cross-session sort doesn't arrive. The daemon pushes `sortMode`
 * on `ui-prefs` (`daemon/ui-prefs-watcher.ts`) and the client parses it into
 * `UiPrefsPayload` (`client/remote-orchestrator-payloads.ts`), but `host-boot.tsx`'s
 * `UiPrefsSync` → `applyUiPrefs` only carries theme / transparentBackground /
 * focusAccent, so `sortMode` and `projectFilter` are dropped. A sort toggle is
 * local to its session. `setSortMode` is kept deliberately: it's the
 * kv-write-free (non-echoing) setter a follow effect would need. Restoring it is
 * a product decision, not cleanup.
 */

import { useState } from "react"
import type { TaskSortMode } from "../../../tui/panes/sidebar/groups"
import type { Task } from "../../../types/task.ts"
import type { KVContext } from "../../context/kv"

export interface SidebarHostState {
  readonly sortMode: TaskSortMode
  /** Raw state setter (no kv write) — for hosts following ui-prefs pushes. */
  readonly setSortMode: (next: TaskSortMode) => void
  /** Apply locally for instant feedback, then persist to state.json (the daemon's ui-prefs watcher fans it out). */
  readonly toggleSortMode: () => void
  readonly moveMode: boolean
  readonly setMoveMode: (next: boolean) => void
  /**
   * `shift+m`: select a row and toggle move mode. j/k then move by the cursor
   * row's LEVEL: a tab within its task, a task within its repo group, a `main`
   * row its whole project.
   */
  readonly onLocalMergeRequest: (id: string) => void
}

/** The order `t` walks; `default` first so one press from anywhere returns to the resting sort. */
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

  // Seeding from `activeSortMode` is what makes the sort global: a new host
  // opens in the last sort. The live push is not applied (KNOWN GAP above).
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
