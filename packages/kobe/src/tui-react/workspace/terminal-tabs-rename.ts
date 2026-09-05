/**
 * Rename a tab of ANY task — mounted or not (`rove api rename --tab`).
 *
 * Same two routes as `moveTaskTab`, for the same reason: the request names a
 * task whose `TerminalTabs` may or may not be mounted, and the mounted
 * component owns its state. Claimed → the component renames through its own
 * `update` (which also persists); unclaimed → write the module map + kv
 * snapshot here, so the sidebar tree and the next mount render the new name.
 *
 * Unlike the CLOSE path this needs no request/reply broker. A close kills
 * PTYs, so running it twice is destructive and the CLI has to know whether a
 * TUI already did it. A rename is idempotent — `setTabTitle` returns the same
 * object when the title already matches — so the CLI writes the snapshot
 * itself AND broadcasts, and the two converge on the same value whichever
 * order they land in.
 */

import { setTabTitle } from "../../tui/workspace/terminal-tabs-core"
import { type TabsSnapshotKv, terminalTabsKey } from "./terminal-tabs-persist"
import { knownTabsState, requestTabRename, setTaskTabs, takeUnclaimedTabRename } from "./terminal-tabs-shared"

/**
 * Rename `tabId` of `taskId`. Returns whether the tab was found — false
 * covers "no such tab" and "task never opened tabs". A rename to the title
 * the tab already carries still reports true: the caller asked for a state,
 * and that state holds.
 */
export function renameTaskTab(kv: TabsSnapshotKv, taskId: string, tabId: string, title: string): boolean {
  const state = knownTabsState(kv, taskId)
  // Checked BEFORE publishing, like `closeTaskTab`: a mounted component
  // claims by task, so publishing an unknown tab id would report success for
  // a rename that made no transition.
  if (!state || !state.tabs.some((tab) => tab.id === tabId)) return false
  requestTabRename(taskId, tabId, title)
  const unclaimed = takeUnclaimedTabRename()
  // Claimed: the mounted TerminalTabs already ran it through its own writer.
  if (!unclaimed) return true

  const next = setTabTitle(state, tabId, title)
  // Same object = the tab already had this title. Nothing to persist, and the
  // caller still asked for a state that now holds.
  if (next === state) return true
  setTaskTabs(taskId, next)
  kv.set(terminalTabsKey(taskId), next)
  return true
}
