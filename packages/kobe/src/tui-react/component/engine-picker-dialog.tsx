/** @jsxImportSource @opentui/react */
/**
 * Change-engine dialog — the tree menu's "Change engine" entry. The `v` chord
 * cycles blindly to the next available engine; a menu entry that did the same
 * would hide which engine the user is about to land on, so the menu offers a
 * pick instead (owner call 2026-09-01). Same shape as `status-picker-dialog`:
 * a plain pick over a closed list, no free text — the list IS what
 * `availableEngineIds()` returned, and a name outside it cannot launch.
 *
 * Picking persists the task's vendor and nothing else; like `v`, it takes
 * effect on the task's next enter (`applyVendorChange` says so in its toast).
 */

import { TextAttributes } from "@opentui/core"
import { useState } from "react"
import { engineDisplayName } from "../../engine/interactive-command"
import type { PickerWindow } from "../../tui/component/new-task-dialog/state"
import { clampCursor } from "../../tui/component/new-task-dialog/state"
import type { VendorId } from "../../types/vendor"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { useBindings } from "../lib/keymap"
import { type DialogContext, showDialog, useDialog, useDialogPaddingX } from "../ui/dialog"
import { PickerList } from "./new-task-dialog/picker-list"

export function EnginePickerDialogView(props: {
  engines: readonly VendorId[]
  /** The task's current engine — the list opens on it and marks it. */
  current: VendorId
  onSubmit: (value: VendorId) => void
  onCancel: () => void
}) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const t = useT()
  const padX = useDialogPaddingX()
  const { engines } = props

  const [cursor, setCursor] = useState(() => Math.max(0, engines.indexOf(props.current)))

  // The available-engine list is a handful of rows; no window to slide.
  const window: PickerWindow = { items: [...engines], start: 0, total: engines.length }

  function move(delta: 1 | -1): void {
    setCursor((c) => clampCursor(c + delta, engines.length))
  }

  function commit(engine: VendorId): void {
    props.onSubmit(engine)
    dialog.clear()
  }

  const rows = engines.map((engine, i) => ({
    key: `${i}:${engine}`,
    body: engineDisplayName(engine),
    accent: engine === props.current,
    dim: engine === props.current ? t("tasks.changeEngine.current") : undefined,
  }))

  useBindings(() => ({
    bindings: [
      { key: "up", cmd: () => move(-1) },
      { key: "down", cmd: () => move(1) },
      { key: "return", cmd: () => commit(engines[cursor] ?? props.current) },
    ],
  }))

  return (
    <box paddingLeft={padX} paddingRight={padX} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {t("tasks.changeEngine.title")}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => props.onCancel()}>
          esc
        </text>
      </box>
      <PickerList
        window={window}
        cursor={cursor}
        rows={rows}
        onPick={(absoluteIndex) => commit(engines[absoluteIndex] ?? props.current)}
        paddingBottom={1}
      />
      <box paddingBottom={1}>
        <text fg={theme.textMuted}>{t("tasks.changeEngine.footer")}</text>
      </box>
    </box>
  )
}

/** Open the picker and resolve with the chosen engine — `undefined` on cancel. */
function show(
  dialog: DialogContext,
  opts: { engines: readonly VendorId[]; current: VendorId },
): Promise<VendorId | undefined> {
  return showDialog<VendorId>(dialog, (resolve) => (
    <EnginePickerDialogView
      engines={opts.engines}
      current={opts.current}
      onSubmit={(v) => resolve(v)}
      onCancel={() => resolve(undefined)}
    />
  ))
}

export const EnginePickerDialog = {
  show,
}
