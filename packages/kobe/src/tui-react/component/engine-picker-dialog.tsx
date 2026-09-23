/** @jsxImportSource @opentui/react */
/**
 * Change-engine dialog (tree menu). Unlike the blind `v` cycle, it shows
 * where you land: a pick over exactly `availableEngineIds()`, no free text.
 *
 * Engines declaring `effortLevels` get a level row; engines declaring
 * `modelArgv` get the shared `model-field.tsx` input (`tab` moves focus).
 * This and `rove api set-effort` / `set-model` change them after creation;
 * only `rove api add --effort/--model` reaches the FIRST session.
 *
 * Picking persists vendor, level and model only; like `v`, it takes effect on
 * the task's next enter.
 */

import { TextAttributes } from "@opentui/core"
import { useState } from "react"
import { engineDisplayName } from "../../engine/interactive-command"
import { engineEntry } from "../../engine/registry"
import type { PickerWindow } from "../../tui/component/new-task-dialog/state"
import { clampCursor, pickerVisibleRows } from "../../tui/component/new-task-dialog/state"
import type { VendorId } from "../../types/vendor"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { useBindings } from "../lib/keymap"
import { useTerminalDimensions } from "../lib/use-terminal-dimensions"
import { type DialogContext, showDialog, useDialog, useDialogPaddingX } from "../ui/dialog"
import { ChipRow, DialogSection } from "../ui/dialog-parts"
import { ModelSection, engineAcceptsModel, useModelField } from "./model-field"
import { PickerList } from "./new-task-dialog/picker-list"

/** What the dialog resolves to: the engine, plus the level when one applies. */
export type EnginePickResult = {
  readonly vendor: VendorId
  /** Absent = the engine declares no levels, so leave the task's alone.
   *  `""` = the user chose the engine's own default, i.e. clear it. */
  readonly effort?: string
  /** Same tri-state for the model: absent = the engine takes none. */
  readonly model?: string
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
  /** The task's pinned model, when it has one. */
  currentModel?: string
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
  // Which control has the keys: the engine list, or the model input.
  const [field, setField] = useState<"engine" | "model">("engine")

  // The available-engine list is a handful of rows; no window to slide.
  const window: PickerWindow = { items: [...engines], start: 0, total: engines.length }

  const cursorEngine = engines[cursor] ?? props.current
  const levels = effortLevelsOf(cursorEngine)
  const effortChoices = levels.length > 0 ? [NO_EFFORT, ...levels] : []
  const modelRow = engineAcceptsModel(cursorEngine)
  const model = useModelField({
    vendor: cursorEngine,
    pickerRows: pickerVisibleRows(useTerminalDimensions().height),
    initial: props.currentModel,
    initialVendor: props.current,
  })
  const modelFocused = modelRow && field === "model"

  function move(delta: 1 | -1): void {
    setCursor((c) => {
      const next = clampCursor(c + delta, engines.length)
      // Never submit a level the engine under the cursor didn't declare.
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
    props.onSubmit({
      vendor: engine,
      ...(applicable.length > 0 ? { effort: seedEffort(engine, effort) } : {}),
      ...(engineAcceptsModel(engine) ? { model: model.value.trim() } : {}),
    })
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
      { key: "up", cmd: () => (modelFocused ? model.moveCursor(-1) : move(-1)) },
      { key: "down", cmd: () => (modelFocused ? model.moveCursor(1) : move(1)) },
      // ←/→, Enter: the input owns them while it has focus (cursor moves;
      // Enter reaches `commit` through the input's onSubmit instead).
      ...(modelFocused
        ? []
        : [
            { key: "left", cmd: () => stepEffort(-1) },
            { key: "right", cmd: () => stepEffort(1) },
            { key: "return", cmd: () => commit(engines[cursor] ?? props.current) },
          ]),
      // PROPOSED chord (owner sign-off pending): tab hops list ↔ model input.
      ...(modelRow ? [{ key: "tab", cmd: () => setField((f) => (f === "engine" ? "model" : "engine")) }] : []),
    ],
  }))

  const footer = [
    t("tasks.changeEngine.footer.engine"),
    ...(modelRow ? [t("tasks.changeEngine.footer.model")] : []),
    ...(effortChoices.length > 0 ? [t("tasks.changeEngine.footer.effort")] : []),
    t("tasks.changeEngine.footer.set"),
    t("tasks.changeEngine.footer.cancel"),
  ].join(" · ")

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
        paddingBottom={effortChoices.length > 0 || modelRow ? 0 : 1}
        focused={!modelFocused}
      />
      {modelRow ? (
        <ModelSection
          field={model}
          focused={modelFocused}
          hint="tab"
          onFocus={() => setField("model")}
          onSubmit={() => commit(cursorEngine)}
        />
      ) : null}
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
        <text fg={theme.textMuted}>{footer}</text>
      </box>
    </box>
  )
}

/** Open the picker and resolve with the chosen engine — `undefined` on cancel. */
function show(
  dialog: DialogContext,
  opts: { engines: readonly VendorId[]; current: VendorId; currentEffort?: string; currentModel?: string },
): Promise<EnginePickResult | undefined> {
  return showDialog<EnginePickResult>(dialog, (resolve) => (
    <EnginePickerDialogView
      engines={opts.engines}
      current={opts.current}
      currentEffort={opts.currentEffort}
      currentModel={opts.currentModel}
      onSubmit={(v) => resolve(v)}
      onCancel={() => resolve(undefined)}
    />
  ))
}

export const EnginePickerDialog = {
  show,
}
