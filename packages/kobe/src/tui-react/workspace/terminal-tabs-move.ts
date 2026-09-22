/**
 * Move a tab of ANY task (sidebar move mode). Same two routes as
 * `closeTaskTab`: claimed → the mounted component reorders via `update`
 * (persists); unclaimed → write map + kv here. Order is the persisted `tabs`
 * array (`rehydrateTabs` keeps it), so moves survive restart.
 */

import { moveTab } from "../../tui/workspace/terminal-tabs-core"
import { type TabsSnapshotKv, terminalTabsKey } from "./terminal-tabs-persist"
import { knownTabsState, requestTabMove, setTaskTabs, takeUnclaimedTabMove } from "./terminal-tabs-shared"

/** Whether the order changed; false for no such tab, no tabs, or the edge-stop (never wraps). */
export function moveTaskTab(kv: TabsSnapshotKv, taskId: string, tabId: string, delta: -1 | 1): boolean {
  requestTabMove(taskId, tabId, delta)
  const unclaimed = takeUnclaimedTabMove()
  // Claimed: the component edge-stops identically, so report "changed".
  if (!unclaimed) return true

  const state = knownTabsState(kv, taskId)
  if (!state) return false
  const next = moveTab(state, tabId, delta)
  if (next === state) return false
  setTaskTabs(taskId, next)
  kv.set(terminalTabsKey(taskId), next)
  return true
}
