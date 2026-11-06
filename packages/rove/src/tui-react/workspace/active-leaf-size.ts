import { getDefaultPtyRegistry } from "../../tui/panes/terminal/registry"
import { type TabsState, splitLeafPtyKey, tabPtyKeyFor } from "../../tui/workspace/terminal-tabs-core"

/** The active tab's focused-leaf emulator cells, for split-core's size gate; null → depth-cap fallback. */
export function activeLeafCells(state: TabsState, taskId: string): { cols: number; rows: number } | null {
  const tab = state.tabs.find((x) => x.id === state.activeId)
  if (!tab) return null
  const leafId = tab.splitTree?.activeLeafId ?? "leaf-1"
  const key = splitLeafPtyKey(tabPtyKeyFor(taskId, tab), leafId)
  return getDefaultPtyRegistry().get(key)?.size ?? null
}
