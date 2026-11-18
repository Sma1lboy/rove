/**
 * The rail's sort mode, shared by the rail and by Reorder (which needs manual order). One answer for every
 * browser on the daemon (the `railSort` pref); localStorage only draws the first frame in it.
 */

import { prefsStore, savePref } from "./prefs.ts"
import { SORT_MODES, type SortMode } from "./rail.ts"
import { createStore } from "./store.ts"

const SORT_KEY = "rove.activeSortMode"

export function loadSort(): SortMode {
  const saved = localStorage.getItem(SORT_KEY)
  // Recency by default; "default" (manual order) is one `t` away and what drag and Reorder need.
  return SORT_MODES.find((mode) => mode === saved) ?? "recent"
}

export const railSort = createStore<SortMode>(loadSort())

function show(next: SortMode): void {
  if (next === railSort.get()) return
  railSort.set(next)
  localStorage.setItem(SORT_KEY, next)
}

// Another browser changed it, or this one just did.
prefsStore.subscribe(() => {
  const { loaded, prefs } = prefsStore.get()
  if (loaded && SORT_MODES.includes(prefs.railSort)) show(prefs.railSort)
})

export function setRailSort(next: SortMode): void {
  show(next)
  savePref("railSort", next)
}

export function cycleRailSort(): void {
  setRailSort(SORT_MODES[(SORT_MODES.indexOf(railSort.get()) + 1) % SORT_MODES.length] ?? "default")
}
