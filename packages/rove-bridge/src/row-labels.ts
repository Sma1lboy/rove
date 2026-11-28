/**
 * What a task row is called, computed once here so every client shows the same name: the TUI's
 * rule (`worktreeRowLabel`) over the stored title, which the daemon keeps at the newest name reported.
 */

import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { worktreeRowLabel } from "@sma1lboy/rove/src/sidebar/tree-labels.ts"
import type { Task } from "@sma1lboy/rove/src/types/task.ts"

/** taskId → row name. Main and dir rows have no live HEAD here, so they read the stored branch. */
export function rowLabels(tasks: readonly SerializedTask[]): ReadonlyMap<string, string> {
  return new Map(tasks.map((task) => [task.id, worktreeRowLabel(task as unknown as Task)]))
}
