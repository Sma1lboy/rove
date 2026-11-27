/** The rail's multi-pick: Shift+click picks a range of task rows, Cmd/Ctrl+click one more; right click on a pick acts on all of it. */

import type { KeyboardEvent, MouseEvent } from "react"
import type { TaskRow } from "rove-bridge/protocol"
import { BridgeRequestError } from "./bridge.ts"
import { ConfirmDialog, errorText } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import type { NavRow } from "./rail.ts"
import { createStore } from "./store.ts"
import { tc } from "./tui-copy.ts"
import { type MenuItem, dialog, toast } from "./ui.ts"

/** Picked task ids, and the row a Shift+click ranges from. */
export const railPick = createStore<{ readonly ids: ReadonlySet<string>; readonly anchor: string | null }>({
  ids: new Set(),
  anchor: null,
})

export function clearPick(): void {
  if (railPick.get().ids.size > 0) railPick.set({ ids: new Set(), anchor: railPick.get().anchor })
}

/**
 * A click on a task row. Shift ranges from the anchor (else `cursorId`), Cmd/Ctrl toggles; both return true and the
 * row does not open. A plain click clears the pick and becomes the next anchor.
 */
export function pickClick(e: MouseEvent, rowId: string, rows: readonly NavRow[], cursorId: string | null): boolean {
  const { ids, anchor } = railPick.get()
  if (e.shiftKey) {
    const taskIds = rows.flatMap((row) => (row.kind === "task" ? [row.id] : []))
    const from = taskIds.indexOf(anchor ?? cursorId ?? rowId)
    const to = taskIds.indexOf(rowId)
    const [lo, hi] = from < 0 ? [to, to] : [Math.min(from, to), Math.max(from, to)]
    railPick.set({ ids: new Set(taskIds.slice(lo, hi + 1)), anchor: anchor ?? cursorId })
    return true
  }
  if (e.metaKey || e.ctrlKey) {
    const next = new Set(ids)
    // The first Cmd+click picks the row the cursor is on too, as Finder keeps its selection.
    if (next.size === 0 && cursorId && rows.some((row) => row.kind === "task" && row.id === cursorId))
      next.add(cursorId)
    if (next.has(rowId)) next.delete(rowId)
    else next.add(rowId)
    railPick.set({ ids: next, anchor: rowId })
    return true
  }
  railPick.set({ ids: new Set(), anchor: rowId })
  return false
}

/** Esc drops the pick before the rail's own keys see it. */
export function pickEscape(e: KeyboardEvent): boolean {
  if (e.key !== "Escape" || railPick.get().ids.size === 0) return false
  clearPick()
  e.preventDefault()
  return true
}

/** A right click on a row that is part of a pick of two or more: the menu for all of them. Elsewhere the pick goes. */
export function pickRowMenu(model: AppModel, rowId: string, rows: readonly NavRow[]): MenuItem[] | null {
  const { ids } = railPick.get()
  const tasks = rows.flatMap((row) => (row.kind === "task" && ids.has(row.id) ? [row.task] : []))
  if (ids.has(rowId) && tasks.length > 1) return pickMenu(model, tasks)
  clearPick()
  return null
}

/** The right-click menu for two or more picked tasks. */
function pickMenu(model: AppModel, tasks: readonly TaskRow[]): MenuItem[] {
  const count = tasks.length
  return [
    { label: t("menu.archiveMany", { count }), section: "danger", run: () => void archiveMany(model, tasks) },
    {
      label: t("menu.removeMany", { count }),
      section: "danger",
      danger: true,
      run: () =>
        dialog.set(
          <ConfirmDialog
            title={t("menu.removeManyTitle", { count })}
            body={t("menu.removeManyBody")}
            confirmLabel={tc("tasks", "confirm.deleteConfirm")}
            onConfirm={async () => void removeMany(model, tasks)}
          />,
        ),
    },
  ]
}

/** A picked task under a picked parent goes with it, so only the topmost picks are sent. */
function topmost(tasks: readonly TaskRow[]): TaskRow[] {
  const picked = new Set(tasks.map((task) => task.id))
  const parentOf = new Map(tasks.map((task) => [task.id, task.parentTaskId]))
  return tasks.filter((task) => {
    for (let up = task.parentTaskId; up; up = parentOf.get(up)) if (picked.has(up)) return false
    return true
  })
}

/** Runs `op` on each task; the ones refused with `code` are asked about once, together, and retried with force. */
async function eachThenForce(
  tasks: readonly TaskRow[],
  op: (task: TaskRow, force: boolean) => Promise<unknown>,
  code: string,
  ask: { title: string; body: string; confirm: string },
  done: (count: number) => void,
): Promise<void> {
  const refused: TaskRow[] = []
  const failed: string[] = []
  let ok = 0
  // One at a time: a picked parent and child would race each other in the daemon.
  for (const task of tasks) {
    try {
      await op(task, false)
      ok++
    } catch (err) {
      if (err instanceof BridgeRequestError && err.code === code) refused.push(task)
      else failed.push(`${task.label}: ${errorText(err)}`)
    }
  }
  clearPick()
  if (ok > 0) done(ok)
  if (failed.length > 0) toast(failed.join("\n"), "error")
  if (refused.length === 0) return
  dialog.set(
    <ConfirmDialog
      title={ask.title}
      body={`${ask.body}\n\n${refused.map((task) => task.label).join("\n")}`}
      confirmLabel={ask.confirm}
      onConfirm={async () => {
        let won = 0
        const lost: string[] = []
        for (const task of refused) {
          try {
            await op(task, true)
            won++
          } catch (err) {
            lost.push(`${task.label}: ${errorText(err)}`)
          }
        }
        if (won > 0) done(won)
        if (lost.length > 0) toast(lost.join("\n"), "error")
      }}
    />,
  )
}

function archiveMany(model: AppModel, tasks: readonly TaskRow[]): Promise<void> {
  return eachThenForce(
    topmost(tasks),
    (task, force) => model.act("task.archive", { taskId: task.id, archived: true, ...(force ? { force } : {}) }),
    "TASK_BUSY",
    {
      title: tc("tasks", "archive.busyTitle"),
      body: t("menu.archiveManyBusy"),
      confirm: tc("tasks", "archive.busyConfirm"),
    },
    (count) => toast(t("menu.archivedMany", { count })),
  )
}

function removeMany(model: AppModel, tasks: readonly TaskRow[]): Promise<void> {
  return eachThenForce(
    tasks,
    (task, force) => model.act("task.delete", { taskId: task.id, ...(force ? { force } : {}) }),
    "DIRTY_WORKTREE",
    {
      title: t("menu.removeManyDirtyTitle"),
      body: t("menu.removeManyDirtyBody"),
      confirm: tc("tasks", "confirm.forceDeleteConfirm"),
    },
    (count) => toast(t("menu.removedMany", { count })),
  )
}
