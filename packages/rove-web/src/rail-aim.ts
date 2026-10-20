/**
 * Which task a prefix verb aims at (TUI "aim rule", `host-keybindings.ts`): the rail's cursor
 * row while the rail has focus, else the open task.
 */

import type { TaskRow } from "rove-bridge/protocol"
import type { AppModel } from "./model.ts"
import { createStore } from "./store.ts"

/** The task under the rail cursor; the rail keeps it current. */
export const railCursorTask = createStore<string | null>(null)

export function aimedTask(model: AppModel): TaskRow | null {
  const inRail = document.activeElement?.closest(".rail") != null
  const id = (inRail ? railCursorTask.get() : null) ?? model.selection.get().taskId
  return model.tasks.get()?.tasks.find((task) => task.id === id) ?? null
}
