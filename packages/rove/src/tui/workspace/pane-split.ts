/**
 * Plugin-pane placement (`tab.open`): default `"split"` beside the engine in
 * the focused chattab (or `tabId`, from `pane-open --tab`); `"tab"` opens a
 * self-closing command tab. Falls back to a tab when the host can't split: a
 * content tab, or split-core's size gate (min-pane cells from the active
 * leaf's size, depth cap when unknown) made it a no-op.
 */

import { initialSplit, leaves, removeLeaf, renameLeaf, splitActive } from "./split-core"
import { type PersistedSplit, type TabsState, collapseSplit, openCommandTab, setTabSplit } from "./terminal-tabs-core"

export type PanePlacement = "split" | "tab"
export type PaneDirection = "right" | "down"

export function openPluginPane(
  state: TabsState,
  argv: readonly string[],
  title: string,
  placement: PanePlacement = "split",
  direction: PaneDirection = "right",
  /** The active leaf's rendered cells — feeds split-core's size gate. */
  activeSize?: { cols: number; rows: number } | null,
  /** Explicit host tab (`pane-open --tab`); absent = the focused tab. */
  tabId?: string,
): TabsState {
  if (placement === "tab") return openCommandTab(state, argv, title)
  const host =
    tabId === undefined
      ? state.tabs.find((tab) => tab.id === state.activeId)
      : state.tabs.find((tab) => tab.id === tabId)
  if (!host || host.kind === "content") return openCommandTab(state, argv, title)
  // `null` content = the tab's own engine leaf (terminal-tab-split.ts).
  const base = host.splitTree ?? initialSplit<readonly string[] | null>(null)
  const split = splitActive(base, direction === "down" ? "column" : "row", argv, activeSize)
  if (split === base) return openCommandTab(state, argv, title)
  return setTabSplit(state, host.id, renameLeaf(split, split.activeLeafId, title))
}

/**
 * `tab.close`: prune split leaves labelled `title` (never the engine leaf) and
 * list command tabs with that title. Pure; the CALLER releases returned leaves'
 * PTYs and closes returned tabs via its own close path. A tab whose LAST leaf
 * matches closes whole.
 */
export function closePluginPanes(
  state: TabsState,
  title: string,
  /** Scope to one tab (`pane-close --tab`); absent = all of the task's tabs. */
  tabId?: string,
): { next: TabsState; closedLeaves: readonly { tabId: string; leafId: string }[]; closedTabIds: readonly string[] } {
  let next = state
  const closedLeaves: { tabId: string; leafId: string }[] = []
  const closedTabIds: string[] = []
  for (const tab of state.tabs) {
    if (tabId !== undefined && tab.id !== tabId) continue
    if (tab.kind === "content") continue
    if (tab.kind === "command" && tab.title === title) {
      closedTabIds.push(tab.id)
      continue
    }
    const tree = tab.splitTree
    if (!tree) continue
    let cur: PersistedSplit = tree
    let closedWholeTab = false
    for (const leaf of leaves(tree.root)) {
      if (leaf.id === "leaf-1" || leaf.title !== title) continue
      const pruned = removeLeaf(cur, leaf.id)
      if (pruned === null) {
        // Last surviving leaf — close the tab, its close path releases.
        closedTabIds.push(tab.id)
        closedWholeTab = true
        break
      }
      cur = pruned
      closedLeaves.push({ tabId: tab.id, leafId: leaf.id })
    }
    if (!closedWholeTab && cur !== tree) next = setTabSplit(next, tab.id, collapseSplit(cur))
  }
  return { next, closedLeaves, closedTabIds }
}
