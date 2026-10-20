/**
 * Absorb a tab another process created (`rove api tab-new`, via the daemon's
 * `tab.add` broadcast). Same two routes as `renameTaskTab`: claimed → the
 * mounted component folds it in through `update` (which persists); unclaimed →
 * write the module map + kv here.
 *
 * Idempotent (`absorbTab` returns the same object for a known row), so no
 * request/reply broker: the CLI wrote the snapshot, this only syncs this
 * process's copy so its next write can't drop the row.
 */

import { loadStateFile } from "../../state/store"
import { absorbTab } from "../../tui/workspace/tabs-adopt"
import type { CommandTab, EngineTab, TabsState } from "../../tui/workspace/terminal-tabs-core"
import { type TabsSnapshotKv, terminalTabsKey } from "./terminal-tabs-persist"
import {
  knownTabsState,
  reportTabsDelta,
  requestTabAdd,
  setTaskTabs,
  takeUnclaimedTabAdd,
} from "./terminal-tabs-shared"

/** state.json's copy, for a task this process never opened: its kv was hydrated before the row existed. */
function savedTabs(taskId: string): TabsState | null {
  const saved = loadStateFile()[terminalTabsKey(taskId)] as TabsState | null | undefined
  return saved && Array.isArray(saved.tabs) ? saved : null
}

export function addTaskTab(kv: TabsSnapshotKv, taskId: string, tab: EngineTab | CommandTab): void {
  requestTabAdd(taskId, tab)
  if (!takeUnclaimedTabAdd()) return

  const known = knownTabsState(kv, taskId)
  const state = known ?? savedTabs(taskId)
  if (!state) return
  const next = absorbTab(state, tab)
  if (next === state && known) return
  setTaskTabs(taskId, next)
  kv.set(terminalTabsKey(taskId), next)
  // A real open: otherwise the tab's `tab.closed` is the first a plugin hears of it.
  reportTabsDelta(taskId, state.tabs, next.tabs)
}
