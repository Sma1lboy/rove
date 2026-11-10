/**
 * What a click changes in the task list, drawn before the daemon confirms it. Each edit is the
 * list the daemon's next push will carry, so the row moves when clicked and not a round trip later.
 */

import type { TaskRow, TasksPayload } from "rove-bridge/protocol"

export type TasksEdit = (payload: TasksPayload) => TasksPayload

const patch =
  (id: string, change: Partial<TaskRow>): TasksEdit =>
  (payload) => ({ ...payload, tasks: payload.tasks.map((task) => (task.id === id ? { ...task, ...change } : task)) })

export const pinEdit = (id: string, pinned: boolean): TasksEdit => patch(id, { pinned })

/** The task and everything under it, as the daemon archives and deletes a subtree. */
function subtree(rows: readonly TaskRow[], id: string): ReadonlySet<string> {
  const ids = new Set([id])
  for (let grew = true; grew; ) {
    grew = false
    for (const row of rows) {
      if (row.parentTaskId && ids.has(row.parentTaskId) && !ids.has(row.id)) {
        ids.add(row.id)
        grew = true
      }
    }
  }
  return ids
}

export const archiveEdit =
  (id: string, archived: boolean): TasksEdit =>
  (payload) => {
    const from = archived ? payload.tasks : (payload.archived ?? [])
    const ids = subtree(from, id)
    const moved = from.filter((task) => ids.has(task.id)).map((task) => ({ ...task, archived }))
    const rest = from.filter((task) => !ids.has(task.id))
    return archived
      ? { ...payload, tasks: rest, archived: [...(payload.archived ?? []), ...moved] }
      : { ...payload, tasks: [...payload.tasks, ...moved], archived: rest }
  }

/** A delete in flight: the row is gone. `cascade` takes its children too; without it they stay and the daemon re-parents them. */
export const deleteEdit =
  (id: string, cascade: boolean): TasksEdit =>
  (payload) => {
    const all = [...payload.tasks, ...(payload.archived ?? [])]
    const ids = cascade ? subtree(all, id) : new Set([id])
    const parent = all.find((task) => task.id === id)?.parentTaskId
    const keep = (rows: readonly TaskRow[]) =>
      rows
        .filter((task) => !ids.has(task.id))
        .map((task) => (task.parentTaskId === id ? { ...task, parentTaskId: parent } : task))
    return { ...payload, tasks: keep(payload.tasks), ...(payload.archived ? { archived: keep(payload.archived) } : {}) }
  }
