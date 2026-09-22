/** @jsxImportSource @opentui/react */
/**
 * Add-engine protocol step: which built-in adapter this preset talks like,
 * written to `engineProtocol.<id>` (decides transcript reader, account
 * detection and delivery vs the generic adapter).
 *
 * A pick over a closed set, not free text: a misspelt `cluade` would silently
 * fall back to generic. Here "generic" is a row you choose.
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
const NO_ENGINE_PROTOCOL = ""

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

  // Five fixed rows always fit; no window to slide, just `PickerList`'s shape.
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
 * Resolve with the chosen protocol: `""` for generic, `undefined` on cancel
 * (which aborts the add).
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
