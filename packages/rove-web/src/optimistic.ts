/**
 * What a click changes in the task list, drawn before the daemon confirms it. Each edit is the
 * list the daemon's next push will carry, so the row moves when clicked and not a round trip later.
 */

import type { TaskRow, TasksPayload } from "rove-bridge/protocol"

export type TasksEdit = (payload: TasksPayload) => TasksPayload

const patch =
  (id: string, change: Partial<TaskRow>): TasksEdit =>
  (payload) => ({ ...payload, tasks: payload.tasks.map((task) => (task.id === id ? { ...task, ...change } : task)) })

/** A row whose label is its title shows the new one; a label the engine set stays. */
const renameEdit =
  (id: string, title: string): TasksEdit =>
  (payload) => ({
    ...payload,
    tasks: payload.tasks.map((task) =>
      task.id === id ? { ...task, title, label: task.label === task.title ? title : task.label } : task,
    ),
  })

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
const deleteEdit =
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

type Args = Readonly<Record<string, unknown>>

/** Every op whose effect on the list is known before the daemon answers. `AppModel.act` draws it on the click. */
const EDITS: Readonly<Record<string, (id: string, args: Args) => TasksEdit>> = {
  "task.pin": (id, a) => patch(id, { pinned: a.pinned === true }),
  "task.keep": (id, a) => patch(id, { kept: a.kept === true } as Partial<TaskRow>),
  "task.setStatus": (id, a) => patch(id, { status: a.status } as Partial<TaskRow>),
  "task.rename": (id, a) => renameEdit(id, String(a.title)),
  "task.archive": (id, a) => archiveEdit(id, a.archived === true),
  "task.delete": (id, a) => deleteEdit(id, a.cascade === true),
}

export const EDITED_OPS: readonly string[] = Object.keys(EDITS)

export function taskEdit(op: string, args: Args): TasksEdit | null {
  return EDITS[op]?.(String(args.taskId), args) ?? null
}
