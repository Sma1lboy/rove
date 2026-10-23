/**
 * Rows for the engine-tab → child-task migration: a parent's extra engine
 * conversation becomes a shared child, and the alias that points it at a
 * still-running parent-keyed PTY comes and goes here.
 */

import type { MigratedChildInput, TaskPtyAlias } from "@sma1lboy/rove-daemon/daemon/contracts"
import type { Task } from "../types/task.ts"
import { TaskDeletingError, TaskNotFoundError } from "./errors.ts"
import type { TaskIndexStore } from "./index/store.ts"
import { sharedChildRow } from "./spawn-child.ts"
import { PLACEHOLDER_TASK_TITLE, sanitizeTaskTitle } from "./title.ts"

/** The parent's directory as recorded: a boot-time migration must not run `git worktree add`. */
export async function createMigratedChildRow(
  deps: { store: TaskIndexStore },
  input: MigratedChildInput,
): Promise<Task> {
  const parent = deps.store.get(input.parentTaskId)
  if (!parent) throw new TaskNotFoundError(input.parentTaskId)
  if (parent.deletion) throw new TaskDeletingError(String(parent.id))

  // A tab that pinned no engine ran what its parent runs.
  const inherit = !input.vendor && !input.command
  const row = sharedChildRow(parent, parent.worktreePath, {
    title: sanitizeTaskTitle(input.title) || PLACEHOLDER_TASK_TITLE,
    vendor: input.vendor ?? parent.vendor,
    command: input.command ?? (inherit ? parent.command : undefined),
  })
  return await deps.store.create({ ...row, ...(input.ptyAlias ? { ptyAlias: input.ptyAlias } : {}) })
}

export async function setPtyAliasRow(
  deps: { store: TaskIndexStore },
  id: string,
  alias: TaskPtyAlias | null,
): Promise<void> {
  const task = deps.store.get(id)
  if (!task) throw new TaskNotFoundError(id)
  if (alias === null && !task.ptyAlias) return
  await deps.store.update(id, { ptyAlias: alias ?? undefined })
}
