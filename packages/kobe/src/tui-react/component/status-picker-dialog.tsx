/** @jsxImportSource @opentui/react */
/**
 * Set-status dialog — the tree menu's "Set status" entry. A plain pick over
 * the six `TaskStatus` values, no free text: unlike the branch picker (whose
 * input doubles as "create this name"), the status union is closed, so typing
 * could only ever produce an invalid value.
 *
 * COSMETIC by contract. Picking `canceled` labels the task and nothing else —
 * its worktree, branch and sessions stay exactly where they are (the framing
 * `cli/api/verbs-edit.ts` and `setStatusFlow` both carry). That is why this
 * dialog has no confirm step and no danger tone: there is nothing here to
 * undo but another pick.
 *
 * Reuses the shared `PickerList` so the rows, cursor arrow and mouse picking
 * match every other picker in the dialog layer.
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
 * `TaskStatus` → its `tasks.status.*` i18n key. Written out rather than
 * derived from the union member so a snake_case wire value never has to agree
 * with a camelCase message key by string surgery; the `Record` makes the
 * compiler demand an entry the day a seventh status lands.
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
