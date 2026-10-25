/** The rail's sort mode, shared by the rail and by Reorder (which needs manual order). Kept per browser, as the TUI's `activeSortMode`. */

import { SORT_MODES, type SortMode } from "./rail.ts"
import { createStore } from "./store.ts"

const SORT_KEY = "rove.activeSortMode"

function loadSort(): SortMode {
  const saved = localStorage.getItem(SORT_KEY)
  // Recency by default; "default" (manual order) is one `t` away and what drag and Reorder need.
  return SORT_MODES.find((mode) => mode === saved) ?? "recent"
}

export const railSort = createStore<SortMode>(loadSort())

export function setRailSort(next: SortMode): void {
  railSort.set(next)
  localStorage.setItem(SORT_KEY, next)
}

export function cycleRailSort(): void {
  setRailSort(SORT_MODES[(SORT_MODES.indexOf(railSort.get()) + 1) % SORT_MODES.length] ?? "default")
}
