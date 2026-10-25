/**
 * Reorder (TUI sidebar move mode): Shift+M, `ctrl+a m` or the menu turns it on, then j/k move
 * the cursor row at its own level: a task within its project, a main
 * row the whole project. Every level stops at its edge. Enter or Esc leaves.
 */

import type { AppModel } from "./model.ts"
import { railSort, setRailSort } from "./rail-sort.ts"
import type { NavRow } from "./rail.ts"
import { createStore } from "./store.ts"
import { tc } from "./tui-copy.ts"
import { toast } from "./ui.ts"

export const moveMode = createStore(false)

/** Reorder edits the stored manual order, so any other sort switches to manual first (with a toast). */
export function setMoveMode(on: boolean): void {
  if (on && railSort.get() !== "default") {
    setRailSort("default")
    toast(tc("tasks", "sort.reorderSwitched"))
  }
  moveMode.set(on)
}

type Movable = Exclude<NavRow, { kind: "project" | "routines" }>

/** Move `row` one step; `delta` -1 is up. A refusal is a toast and the row keeps its place. */
export async function moveRow(model: AppModel, row: Movable, delta: -1 | 1): Promise<void> {
  const direction = delta < 0 ? "up" : "down"
  try {
    // A main row stands for its project: the daemon moves the whole group.
    await model.client.request("task.move", { taskId: row.task.id, direction })
  } catch (err) {
    toast(tc("tasks", "toast.moveFailed", { error: err instanceof Error ? err.message : String(err) }), "error")
  }
}

/** A drop: `steps` single moves, one after another, as the daemon moves one place at a time. */
export async function moveTaskBy(model: AppModel, taskId: string, steps: number): Promise<void> {
  const direction = steps < 0 ? "up" : "down"
  try {
    for (let i = 0; i < Math.abs(steps); i++) await model.client.request("task.move", { taskId, direction })
  } catch (err) {
    toast(tc("tasks", "toast.moveFailed", { error: err instanceof Error ? err.message : String(err) }), "error")
  }
}
