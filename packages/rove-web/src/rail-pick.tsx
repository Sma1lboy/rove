/** The rail's multi-pick: Shift+click picks a range of task rows, Cmd/Ctrl+click one more; right click on a pick acts on all of it. */

import type { KeyboardEvent, MouseEvent } from "react"
import type { TaskRow } from "rove-bridge/protocol"
import { BridgeRequestError } from "./bridge.ts"
import { ConfirmDialog, errorText } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { taskEdit } from "./optimistic.ts"
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

/**
 * Sends `op` for every task at once: each row leaves the list on the click, not when its turn comes. Requests to one
 * machine go one after another (a picked parent and child would race in its daemon; each remote one is an ssh trip).
 */
function sendAll(
  model: AppModel,
  tasks: readonly TaskRow[],
  op: string,
  args: (task: TaskRow) => Record<string, unknown>,
): Promise<PromiseSettledResult<unknown>[]> {
  const lanes = new Map<string, Promise<unknown>>()
  return Promise.allSettled(
    tasks.map((task) => {
      const params = { taskId: task.id, ...args(task) }
      const lane = task.machine?.id ?? ""
      const send = (lanes.get(lane) ?? Promise.resolve()).then(() => model.client.request(op, params))
      lanes.set(
        lane,
        send.catch(() => {}),
      )
      const edit = taskEdit(op, params)
      return edit ? model.optimistic(edit, () => send) : send
    }),
  )
}

/** Runs `op` on every task; the ones refused with `code` come back, are asked about once, together, and retried with force. */
async function eachThenForce(
  model: AppModel,
  tasks: readonly TaskRow[],
  op: string,
  args: (task: TaskRow) => Record<string, unknown>,
  code: string,
  ask: { title: string; body: string; confirm: string },
  done: (count: number) => void,
): Promise<void> {
  clearPick()
  const results = await sendAll(model, tasks, op, args)
  const refused = tasks.filter((_, i) => {
    const r = results[i]
    return r?.status === "rejected" && r.reason instanceof BridgeRequestError && r.reason.code === code
  })
  const failed = tasks.flatMap((task, i) => {
    const r = results[i]
    return r?.status === "rejected" && !refused.includes(task) ? [`${task.label}: ${errorText(r.reason)}`] : []
  })
  const ok = results.filter((r) => r.status === "fulfilled").length
  if (ok > 0) done(ok)
  if (failed.length > 0) toast(failed.join("\n"), "error")
  if (refused.length === 0) return
  dialog.set(
    <ConfirmDialog
      title={ask.title}
      body={`${ask.body}\n\n${refused.map((task) => task.label).join("\n")}`}
      confirmLabel={ask.confirm}
      onConfirm={async () => {
        const again = await sendAll(model, refused, op, (task) => ({ ...args(task), force: true }))
        const won = again.filter((r) => r.status === "fulfilled").length
        if (won > 0) done(won)
        const lost = refused.flatMap((task, i) => {
          const r = again[i]
          return r?.status === "rejected" ? [`${task.label}: ${errorText(r.reason)}`] : []
        })
        if (lost.length > 0) toast(lost.join("\n"), "error")
      }}
    />,
  )
}

function archiveMany(model: AppModel, tasks: readonly TaskRow[]): Promise<void> {
  return eachThenForce(
    model,
    topmost(tasks),
    "task.archive",
    () => ({ archived: true }),
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
    model,
    tasks,
    "task.delete",
    () => ({}),
    "DIRTY_WORKTREE",
    {
      title: t("menu.removeManyDirtyTitle"),
      body: t("menu.removeManyDirtyBody"),
      confirm: tc("tasks", "confirm.forceDeleteConfirm"),
    },
    (count) => toast(t("menu.removedMany", { count })),
  )
}
