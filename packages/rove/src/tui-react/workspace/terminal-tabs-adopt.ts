/**
 * Write side of `tui/workspace/tabs-adopt.ts` (which explains why divergence
 * is adopted, not just reported). Same two routes as `closeTaskTab`: claimed →
 * the mounted component appends via `update`; unclaimed → write map + kv here
 * so the next mount attaches to the session already running under its key.
 */

import { adoptTabs } from "../../tui/workspace/tabs-adopt"
import type { TabsState } from "../../tui/workspace/terminal-tabs-core"
import { type TabsSnapshotKv, terminalTabsKey } from "./terminal-tabs-persist"
import { knownTabsState, requestTabAdopt, setTaskTabs, takeUnclaimedTabAdopt } from "./terminal-tabs-shared"

/**
 * No-op when all ids are known: adoption is poll-driven, so the common case
 * must not write. True only when this call wrote background state.
 */
export function adoptTaskTabs(kv: TabsSnapshotKv, taskId: string, tabIds: readonly string[]): boolean {
  if (tabIds.length === 0) return false
  requestTabAdopt(taskId, tabIds)
  const unclaimed = takeUnclaimedTabAdopt()
  if (!unclaimed) return false

  const state = knownTabsState(kv, taskId)
  // Never opened tabs, yet a session runs under one of its keys: start EMPTY
  // (`initialTabs()` would invent a session-less `tab-1`); the first adopted
  // id is active.
  const empty: TabsState = { tabs: [], activeId: tabIds[0] as string, nextOrdinal: 1 }
  const next = adoptTabs(state ?? empty, tabIds)
  if (state && next === state) return false

  setTaskTabs(taskId, next)
  kv.set(terminalTabsKey(taskId), next)
  return true
}
