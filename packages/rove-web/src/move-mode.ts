/**
 * Reorder (TUI sidebar move mode): Shift+M, `ctrl+a m` or the menu turns it on, then j/k move
 * the cursor row at its own level: a tab within its task, a task within its project, a main
 * row the whole project. Every level stops at its edge. Enter or Esc leaves.
 */

import type { AppModel } from "./model.ts"
import type { NavRow } from "./rail.ts"
import { createStore } from "./store.ts"
import { tc } from "./tui-copy.ts"
import { toast } from "./ui.ts"

export const moveMode = createStore(false)

type Movable = Exclude<NavRow, { kind: "project" }>

/** Move `row` one step; `delta` -1 is up. A refusal is a toast and the row keeps its place. */
export async function moveRow(model: AppModel, row: Movable, delta: -1 | 1): Promise<void> {
  const direction = delta < 0 ? "up" : "down"
  try {
    if (row.kind === "tab") {
      await model.client.request("tab.move", { taskId: row.task.id, tabId: row.tab.id, direction })
      await model.refreshTabsNow()
    } else {
      // A main row stands for its project: the daemon moves the whole group.
      await model.client.request("task.move", { taskId: row.task.id, direction })
    }
  } catch (err) {
    toast(tc("tasks", "toast.moveFailed", { error: err instanceof Error ? err.message : String(err) }), "error")
  }
}
