/** A task's checklist as the page uses it: the `2/5` count and the unchecked ones. */

import type { TaskRow } from "rove-bridge/protocol"

/** Done over all; null when the task has no todos (no chip, no warning). */
export function todoCount(task: Pick<TaskRow, "todos">): { done: number; total: number } | null {
  const todos = task.todos
  if (!todos || todos.length === 0) return null
  return { done: todos.filter((todo) => todo.done).length, total: todos.length }
}

export function openTodos(task: Pick<TaskRow, "todos">): readonly { id: string; text: string }[] {
  return (task.todos ?? []).filter((todo) => !todo.done)
}
