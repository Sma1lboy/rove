/** @jsxImportSource @opentui/react */
/**
 * Change-engine dialog — the tree menu's "Change engine" entry. The `v` chord
 * cycles blindly to the next available engine; a menu entry that did the same
 * would hide which engine the user is about to land on, so the menu offers a
 * pick instead. Same shape as `status-picker-dialog`:
 * a plain pick over a closed list, no free text — the list IS what
 * `availableEngineIds()` returned, and a name outside it cannot launch.
 *
 * Engines that DECLARE reasoning levels (`EngineRegistryEntry.effortLevels` —
 * codex today) get a second row under the list, so the level is settable on a
 * task that already exists — otherwise the web board's create-time picker is
 * the only surface that can set one, and a codex task is stuck on whatever it
 * launched with. Engines with no declared levels render no row at all,
 * matching the web picker's rule.
 *
 * Picking persists the task's vendor (and level) and nothing else; like `v`,
 * it takes effect on the task's next enter (`applyVendorChange` says so in
 * its toast).
 */

import { TextAttributes } from "@opentui/core"
import { useState } from "react"
import { engineDisplayName } from "../../engine/interactive-command"
import { engineEntry } from "../../engine/registry"
import type { PickerWindow } from "../../tui/component/new-task-dialog/state"
import { clampCursor } from "../../tui/component/new-task-dialog/state"
import type { VendorId } from "../../types/vendor"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { useBindings } from "../lib/keymap"
import { type DialogContext, showDialog, useDialog, useDialogPaddingX } from "../ui/dialog"
import { ChipRow, DialogSection } from "../ui/dialog-parts"
import { PickerList } from "./new-task-dialog/picker-list"

/** What the dialog resolves to: the engine, plus the level when one applies. */
export type EnginePickResult = {
  readonly vendor: VendorId
  /** Absent = the engine declares no levels, so leave the task's alone.
   *  `""` = the user chose the engine's own default, i.e. clear it. */
  readonly effort?: string
}

/** The sentinel choice meaning "no level — use the engine's own default". */
const NO_EFFORT = ""

function effortLevelsOf(vendor: VendorId): readonly string[] {
  return engineEntry(vendor).effortLevels ?? []
}

/** The level to open on for `vendor`: the task's own when that engine still
 *  declares it, else the engine's default (no level pinned). */
function seedEffort(vendor: VendorId, current: string | undefined): string {
  const trimmed = current?.trim()
  return trimmed && effortLevelsOf(vendor).includes(trimmed) ? trimmed : NO_EFFORT
}

export function EnginePickerDialogView(props: {
  engines: readonly VendorId[]
  /** The task's current engine — the list opens on it and marks it. */
  current: VendorId
  /** The task's current reasoning level, when it has one. */
  currentEffort?: string
  onSubmit: (value: EnginePickResult) => void
  onCancel: () => void
}) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const t = useT()
  const padX = useDialogPaddingX()
  const { engines } = props

  const [cursor, setCursor] = useState(() => Math.max(0, engines.indexOf(props.current)))
  const [effort, setEffort] = useState(() => seedEffort(props.current, props.currentEffort))

  // The available-engine list is a handful of rows; no window to slide.
  const window: PickerWindow = { items: [...engines], start: 0, total: engines.length }

  const cursorEngine = engines[cursor] ?? props.current
  const levels = effortLevelsOf(cursorEngine)
  const effortChoices = levels.length > 0 ? [NO_EFFORT, ...levels] : []

  function move(delta: 1 | -1): void {
    setCursor((c) => {
      const next = clampCursor(c + delta, engines.length)
      // The level belongs to the engine under the cursor: carry it across
      // engines that share it, otherwise fall back to that engine's default
      // rather than submitting a level it never declared.
      setEffort((e) => seedEffort(engines[next] ?? props.current, e))
      return next
    })
  }

  function stepEffort(delta: 1 | -1): void {
    if (effortChoices.length === 0) return
    const i = effortChoices.indexOf(effort)
    setEffort(effortChoices[clampCursor((i < 0 ? 0 : i) + delta, effortChoices.length)] ?? NO_EFFORT)
  }

  function commit(engine: VendorId): void {
    const applicable = effortLevelsOf(engine)
    props.onSubmit({ vendor: engine, ...(applicable.length > 0 ? { effort: seedEffort(engine, effort) } : {}) })
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
      { key: "left", cmd: () => stepEffort(-1) },
      { key: "right", cmd: () => stepEffort(1) },
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
        paddingBottom={effortChoices.length > 0 ? 0 : 1}
      />
      {effortChoices.length > 0 ? (
        <DialogSection label={t("tasks.changeEngine.effortLabel")} focused={false} hint="←/→">
          <ChipRow
            choices={effortChoices}
            selected={effort}
            display={(choice) => (choice === NO_EFFORT ? t("tasks.changeEngine.noEffort") : choice)}
            onPick={(choice) => setEffort(choice)}
          />
        </DialogSection>
      ) : null}
      <box paddingBottom={1}>
        <text fg={theme.textMuted}>
          {effortChoices.length > 0 ? t("tasks.changeEngine.footerEffort") : t("tasks.changeEngine.footer")}
        </text>
      </box>
    </box>
  )
}

/** Open the picker and resolve with the chosen engine — `undefined` on cancel. */
function show(
  dialog: DialogContext,
  opts: { engines: readonly VendorId[]; current: VendorId; currentEffort?: string },
): Promise<EnginePickResult | undefined> {
  return showDialog<EnginePickResult>(dialog, (resolve) => (
    <EnginePickerDialogView
      engines={opts.engines}
      current={opts.current}
      currentEffort={opts.currentEffort}
      onSubmit={(v) => resolve(v)}
      onCancel={() => resolve(undefined)}
    />
  ))
}

export const EnginePickerDialog = {
  show,
}
