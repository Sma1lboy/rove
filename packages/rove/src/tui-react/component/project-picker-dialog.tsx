/** @jsxImportSource @opentui/react */
/**
 * "Move to project" dialog: a plain pick over the saved projects, no free text.
 * The move only regroups the row; the picker says nothing about directories
 * because none change.
 */

import { useState } from "react"
import { clampCursor, windowAround } from "../../tui/component/new-task-dialog/state"
import { sidebarProjectLabel } from "../../tui/panes/sidebar/groups"
import { useT } from "../i18n"
import { useBindings } from "../lib/keymap"
import { type DialogContext, showDialog, useDialog, useDialogPaddingX } from "../ui/dialog"
import { DialogFooter, DialogHeader } from "../ui/dialog-parts"
import { PickerList } from "./new-task-dialog/picker-list"

export function ProjectPickerDialogView(props: {
  projects: readonly string[]
  onSubmit: (repo: string) => void
  onCancel: () => void
}) {
  const dialog = useDialog()
  const t = useT()
  const padX = useDialogPaddingX()
  const [cursor, setCursor] = useState(0)

  const window = windowAround([...props.projects], cursor)
  const rows = window.items.map((repo, index) => ({
    key: repo,
    body: sidebarProjectLabel(repo, props.projects),
    accent: window.start + index === cursor,
  }))

  function commit(index: number): void {
    const repo = props.projects[index]
    if (repo === undefined) return
    props.onSubmit(repo)
    dialog.clear()
  }

  useBindings(() => ({
    bindings: [
      { key: "up", cmd: () => setCursor((c) => clampCursor(c - 1, props.projects.length)) },
      { key: "down", cmd: () => setCursor((c) => clampCursor(c + 1, props.projects.length)) },
      { key: "return", cmd: () => commit(cursor) },
    ],
  }))

  return (
    <box paddingLeft={padX} paddingRight={padX} gap={1}>
      <DialogHeader title={t("tasks.moveToProject.title")} onClose={() => props.onCancel()} />
      <PickerList window={window} cursor={cursor} rows={rows} onPick={commit} paddingBottom={1} />
      <DialogFooter>{t("tasks.moveToProject.footer")}</DialogFooter>
    </box>
  )
}

/** Open the picker and resolve with the chosen project's repo — `undefined` on cancel. */
function show(dialog: DialogContext, opts: { projects: readonly string[] }): Promise<string | undefined> {
  return showDialog<string>(dialog, (resolve) => (
    <ProjectPickerDialogView
      projects={opts.projects}
      onSubmit={(repo) => resolve(repo)}
      onCancel={() => resolve(undefined)}
    />
  ))
}

export const ProjectPickerDialog = {
  show,
}
