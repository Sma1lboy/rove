/** A task's checklist as the page uses it: the `2/5` count, the unchecked ones, and the prompt they make. */

import type { TaskRow } from "rove-bridge/protocol"

type Todos = Pick<TaskRow, "todos" | "notes">

/** Done over all; null when the task has no todos (no chip, no warning). */
export function todoCount(task: Pick<TaskRow, "todos">): { done: number; total: number } | null {
  const todos = task.todos
  if (!todos || todos.length === 0) return null
  return { done: todos.filter((todo) => todo.done).length, total: todos.length }
}

export function openTodos(task: Pick<TaskRow, "todos">): readonly { id: string; text: string }[] {
  return (task.todos ?? []).filter((todo) => !todo.done)
}

/** The unchecked todos as one instruction for the engine; null when nothing is left. */
export function todoPrompt(task: Todos): string | null {
  const open = openTodos(task)
  if (open.length === 0) return null
  const list = open.map((todo) => `- ${todo.text}`).join("\n")
  return `Please work through these remaining todos for this task, and tell me what you did for each:\n${list}`
}
