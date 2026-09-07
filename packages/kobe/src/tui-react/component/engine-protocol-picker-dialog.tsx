/** @jsxImportSource @opentui/react */
/**
 * The protocol step of the add-engine flow: which built-in adapter this
 * preset talks like.
 *
 * A pick, not a text field. The set is closed — the built-in vendors, plus a
 * "none" row — and what it writes is `engineProtocol.<id>`, the value that
 * decides whether the preset gets a transcript reader, account detection and
 * engine-specific delivery, or falls back to the generic adapter. Free text
 * could only ever reach that fallback by ACCIDENT: a misspelt `cluade` fails
 * validation, writes nothing, and leaves an engine that reads as generic with
 * nothing on screen saying why. Here "generic" is a row you choose.
 *
 * Same `PickerList` as the status / branch / engine pickers, so the cursor,
 * the arrow and mouse picking behave the way they do in every other picker.
 */

import { useState } from "react"
import { ENGINE_PROTOCOLS } from "../../engine/engine-presets"
import { engineEntry } from "../../engine/registry"
import type { PickerWindow } from "../../tui/component/new-task-dialog/state"
import { clampCursor } from "../../tui/component/new-task-dialog/state"
import { useT } from "../i18n"
import { useBindings } from "../lib/keymap"
import { type DialogContext, showDialog, useDialog, useDialogPaddingX } from "../ui/dialog"
import { DialogFooter, DialogHeader } from "../ui/dialog-parts"
import { PickerList } from "./new-task-dialog/picker-list"

/** The "no adapter" choice — the empty string `engineProtocol.<id>` holds. */
export const NO_ENGINE_PROTOCOL = ""

/** The built-in protocols, with the generic choice last. */
const CHOICES: readonly string[] = [...ENGINE_PROTOCOLS, NO_ENGINE_PROTOCOL]

export function EngineProtocolPickerDialogView(props: {
  /** The engine id being added — named in the title, since this is step 3 of 4. */
  engineId: string
  onSubmit: (protocol: string) => void
  onCancel: () => void
}) {
  const dialog = useDialog()
  const t = useT()
  const padX = useDialogPaddingX()
  const [cursor, setCursor] = useState(0)

  // Five fixed rows always fit, so there is no window to slide — the shape is
  // only what `PickerList` takes.
  const window: PickerWindow = { items: [...CHOICES], start: 0, total: CHOICES.length }

  function commit(protocol: string | undefined): void {
    if (protocol === undefined) return
    props.onSubmit(protocol)
    dialog.clear()
  }

  const rows = CHOICES.map((protocol, i) => ({
    key: `${i}:${protocol || "none"}`,
    body: protocol ? engineEntry(protocol).displayName : t("settings.engines.protocolNone"),
    dim: protocol || undefined,
  }))

  useBindings(() => ({
    bindings: [
      { key: "up", cmd: () => setCursor((c) => clampCursor(c - 1, CHOICES.length)) },
      { key: "down", cmd: () => setCursor((c) => clampCursor(c + 1, CHOICES.length)) },
      { key: "return", cmd: () => commit(CHOICES[cursor]) },
    ],
  }))

  return (
    <box paddingLeft={padX} paddingRight={padX} gap={1}>
      <DialogHeader
        title={t("settings.engines.protocolTitle", { id: props.engineId })}
        onClose={() => props.onCancel()}
      />
      <PickerList
        window={window}
        cursor={cursor}
        rows={rows}
        onPick={(absoluteIndex) => commit(CHOICES[absoluteIndex])}
        paddingBottom={1}
      />
      <DialogFooter>{t("settings.engines.protocolFooter")}</DialogFooter>
    </box>
  )
}

/**
 * Open the picker and resolve with the chosen protocol — the empty string for
 * the generic adapter, `undefined` on cancel (which aborts the add, like the
 * id and command steps before it).
 */
function show(dialog: DialogContext, opts: { engineId: string }): Promise<string | undefined> {
  return showDialog<string>(dialog, (resolve) => (
    <EngineProtocolPickerDialogView
      engineId={opts.engineId}
      onSubmit={(v) => resolve(v)}
      onCancel={() => resolve(undefined)}
    />
  ))
}

export const EngineProtocolPickerDialog = {
  show,
}
