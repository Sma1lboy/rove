/**
 * Move a tab of ANY task (sidebar move mode). Same two routes as
 * `closeTaskTab`: claimed → the mounted component reorders via `update`
 * (persists); unclaimed → write map + kv here. Order is the persisted `tabs`
 * array (`rehydrateTabs` keeps it), so moves survive restart.
 */

import type { TabsSnapshotKv } from "@sma1lboy/rove-client/tabs/terminal-tabs-persist.ts"
import { moveTab } from "../../tabs/terminal-tabs-core"
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
  return true
}
