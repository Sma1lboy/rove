/** How the rail lists tasks: under their projects, or across projects under state headers (`rail-states.ts`). Kept per browser, as the sort. */
import { createStore } from "./store.ts"

export const RAIL_GROUPS = ["project", "state"] as const
export type RailGroup = (typeof RAIL_GROUPS)[number]

const GROUP_KEY = "rove.railGroup"

export const railGroup = createStore<RailGroup>(
  RAIL_GROUPS.find((mode) => mode === localStorage.getItem(GROUP_KEY)) ?? "project",
)

export function setRailGroup(next: RailGroup): void {
  railGroup.set(next)
  localStorage.setItem(GROUP_KEY, next)
}
