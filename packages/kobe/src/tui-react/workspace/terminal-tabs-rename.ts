/**
 * Rename a tab of ANY task (`rove api rename --tab`). Same two routes as
 * `moveTaskTab`: claimed → the mounted component renames through `update`
 * (which persists); unclaimed → write the module map + kv here.
 *
 * No request/reply broker (unlike CLOSE, where a double run kills PTYs): rename
 * is idempotent (`setTabTitle` returns the same object on a match), so the CLI
 * writes the snapshot AND broadcasts and both converge in any order.
 */

import { setTabTitle } from "../../tui/workspace/terminal-tabs-core"
import { type TabsSnapshotKv, terminalTabsKey } from "./terminal-tabs-persist"
import { knownTabsState, requestTabRename, setTaskTabs, takeUnclaimedTabRename } from "./terminal-tabs-shared"

/**
 * False for "no such tab" or "never opened tabs". Renaming to the current title
 * is true: the requested state holds.
 */
export function renameTaskTab(kv: TabsSnapshotKv, taskId: string, tabId: string, title: string): boolean {
  const state = knownTabsState(kv, taskId)
  // Checked BEFORE publishing: a mounted component claims by task, so an unknown
  // tab id would report success for a rename that made no transition.
  if (!state || !state.tabs.some((tab) => tab.id === tabId)) return false
  requestTabRename(taskId, tabId, title)
  const unclaimed = takeUnclaimedTabRename()
  if (!unclaimed) return true

  const next = setTabTitle(state, tabId, title)
  // Same object = already titled; nothing to persist.
  if (next === state) return true
  setTaskTabs(taskId, next)
  kv.set(terminalTabsKey(taskId), next)
  return true
}
