/** @jsxImportSource @opentui/react */
/**
 * Set-status dialog: a plain pick over the closed `TaskStatus` union, no free
 * text.
 *
 * COSMETIC by contract (as in `cli/api/verbs-edit.ts` and `setStatusFlow`):
 * `canceled` labels the task; worktree, branch and sessions stay put. Hence no
 * confirm step and no danger tone.
 */

import { useState } from "react"
import type { PickerWindow } from "../../tui/component/new-task-dialog/state"
import { clampCursor } from "../../tui/component/new-task-dialog/state"
import { TASK_STATUSES, type TaskStatus } from "../../types/task"
import { useT } from "../i18n"
import { useBindings } from "../lib/keymap"
import { type DialogContext, showDialog, useDialog, useDialogPaddingX } from "../ui/dialog"
import { DialogFooter, DialogHeader } from "../ui/dialog-parts"
import { PickerList } from "./new-task-dialog/picker-list"

/**
 * Written out, not derived: snake_case wire values don't map to camelCase keys
 * by string surgery, and the `Record` forces an entry for any new status.
 */
const STATUS_LABEL_KEY: Record<TaskStatus, string> = {
  backlog: "tasks.status.backlog",
  in_progress: "tasks.status.inProgress",
  in_review: "tasks.status.inReview",
  done: "tasks.status.done",
  canceled: "tasks.status.canceled",
  error: "tasks.status.error",
}

export function StatusPickerDialogView(props: {
  /** The task's current status — the list opens on it and marks it. */
  current: TaskStatus
  onSubmit: (value: TaskStatus) => void
  onCancel: () => void
}) {
  const dialog = useDialog()
  const t = useT()
  const padX = useDialogPaddingX()

  const [cursor, setCursor] = useState(() => Math.max(0, TASK_STATUSES.indexOf(props.current)))

  // Six fixed rows always fit, so there is no window to slide — the shape is
  // only what `PickerList` takes.
  const window: PickerWindow = { items: [...TASK_STATUSES], start: 0, total: TASK_STATUSES.length }

  function move(delta: 1 | -1): void {
    setCursor((c) => clampCursor(c + delta, TASK_STATUSES.length))
  }

  function commit(status: TaskStatus): void {
    props.onSubmit(status)
    dialog.clear()
  }

  const rows = TASK_STATUSES.map((status, i) => ({
    key: `${i}:${status}`,
    body: t(STATUS_LABEL_KEY[status]),
    accent: status === props.current,
    dim: status === props.current ? t("tasks.setStatus.current") : undefined,
  }))

  useBindings(() => ({
    bindings: [
      { key: "up", cmd: () => move(-1) },
      { key: "down", cmd: () => move(1) },
      { key: "return", cmd: () => commit(TASK_STATUSES[cursor] ?? props.current) },
    ],
  }))

  return (
    <box paddingLeft={padX} paddingRight={padX} gap={1}>
      <DialogHeader title={t("tasks.setStatus.title")} onClose={() => props.onCancel()} />
      <PickerList
        window={window}
        cursor={cursor}
        rows={rows}
        onPick={(absoluteIndex) => commit(TASK_STATUSES[absoluteIndex] ?? props.current)}
        paddingBottom={1}
      />
      <DialogFooter>{t("tasks.setStatus.footer")}</DialogFooter>
    </box>
  )
}

/** Open the picker and resolve with the chosen status — `undefined` on cancel. */
function show(dialog: DialogContext, opts: { current: TaskStatus }): Promise<TaskStatus | undefined> {
  return showDialog<TaskStatus>(dialog, (resolve) => (
    <StatusPickerDialogView current={opts.current} onSubmit={(v) => resolve(v)} onCancel={() => resolve(undefined)} />
  ))
}

export const StatusPickerDialog = {
  show,
}
