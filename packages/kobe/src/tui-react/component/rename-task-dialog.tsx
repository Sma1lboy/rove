/** @jsxImportSource @opentui/react */
/**
 * Single pre-filled input: Enter commits, esc cancels. Label overrides let
 * it double for chat-tab renames, branch names, launch commands, etc.
 * `stripNewlines` because opentui `<input>` inserts a literal `\n` on Enter.
 */

import { useState } from "react"
import { isBlankText, stripNewlines } from "../../tui/component/new-task-dialog/state"
import { useT } from "../i18n"
import { type DialogContext, showDialog, useDialog, useDialogPaddingX } from "../ui/dialog"
import { DialogField, DialogFooter, DialogHeader, DialogSection } from "../ui/dialog-parts"

export function RenameTaskDialogView(props: {
  currentTitle: string
  dialogTitle?: string
  /** Inner field label — override for non-title reuses (e.g. `"command"`). */
  fieldLabel?: string
  /** Footer verb shown after `enter`. Defaults to `"rename"`. */
  submitLabel?: string
  /** Input placeholder. Defaults to {@link currentTitle}. */
  placeholder?: string
  /** Allow submitting an empty value (e.g. "blank = default"). Default false. */
  allowEmpty?: boolean
  onSubmit: (value: string) => void
  onCancel: () => void
}) {
  const dialog = useDialog()
  const t = useT()
  const padX = useDialogPaddingX()
  const [value, setValue] = useState(props.currentTitle)

  function commit(): void {
    const v = value.trim()
    // Full-width spaces `　` count as blank (`.trim()` strips U+3000 too).
    if (isBlankText(v) && !props.allowEmpty) return
    props.onSubmit(v)
    dialog.clear()
  }

  return (
    <box paddingLeft={padX} paddingRight={padX} gap={1}>
      <DialogHeader title={props.dialogTitle ?? t("common.rename.defaultTitle")} onClose={() => props.onCancel()} />
      <DialogSection label={props.fieldLabel ?? t("common.rename.defaultFieldLabel")} focused={true}>
        <DialogField focused={true}>
          <input
            value={value}
            placeholder={props.placeholder ?? props.currentTitle}
            focused={true}
            onInput={(v: string) => setValue(stripNewlines(v))}
            onSubmit={() => commit()}
          />
        </DialogField>
      </DialogSection>
      <DialogFooter>
        {t("common.rename.footerHint", { submitLabel: props.submitLabel ?? t("common.rename.defaultSubmitLabel") })}
      </DialogFooter>
    </box>
  )
}

/** Resolve with the new title (trimmed); `undefined` on cancel. */
function show(
  dialog: DialogContext,
  currentTitle: string,
  opts: {
    dialogTitle?: string
    /** Inner field label — override for non-title reuses (e.g. `"command"`). */
    fieldLabel?: string
    /** Footer verb after `enter` (default `"rename"`). */
    submitLabel?: string
    /** Input placeholder (default = `currentTitle`). */
    placeholder?: string
    /** Allow submitting an empty value (e.g. "blank = default"). */
    allowEmpty?: boolean
  } = {},
): Promise<string | undefined> {
  return showDialog<string>(dialog, (resolve) => (
    <RenameTaskDialogView
      currentTitle={currentTitle}
      dialogTitle={opts.dialogTitle}
      fieldLabel={opts.fieldLabel}
      submitLabel={opts.submitLabel}
      placeholder={opts.placeholder}
      allowEmpty={opts.allowEmpty}
      onSubmit={(v) => resolve(v)}
      onCancel={() => resolve(undefined)}
    />
  ))
}

export const RenameTaskDialog = {
  show,
}
