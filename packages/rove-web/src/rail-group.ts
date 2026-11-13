/**
 * How the rail lists tasks: under their projects, or across projects under state headers (`rail-states.ts`).
 * Shared by every browser on the daemon, as the sort (`rail-sort.ts`).
 */
import { prefsStore, savePref } from "./prefs.ts"
import { createStore } from "./store.ts"

export const RAIL_GROUPS = ["project", "state"] as const
export type RailGroup = (typeof RAIL_GROUPS)[number]

const GROUP_KEY = "rove.railGroup"

export const railGroup = createStore<RailGroup>(
  RAIL_GROUPS.find((mode) => mode === localStorage.getItem(GROUP_KEY)) ?? "project",
)

function show(next: RailGroup): void {
  if (next === railGroup.get()) return
  railGroup.set(next)
  localStorage.setItem(GROUP_KEY, next)
}

prefsStore.subscribe(() => {
  const { loaded, prefs } = prefsStore.get()
  if (loaded && RAIL_GROUPS.includes(prefs.railGroup)) show(prefs.railGroup)
})

export function setRailGroup(next: RailGroup): void {
  show(next)
  savePref("railGroup", next)
}
