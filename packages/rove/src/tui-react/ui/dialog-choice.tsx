/** @jsxImportSource @opentui/react */
/**
 * Choice dialog — a title, a message and a row of buttons. Left/right (or h/l)
 * move focus, enter commits, esc dismisses; `DialogChoice.show` resolves the
 * chosen option's `value`, `undefined` when dismissed. `DialogConfirm` is the
 * two-button case; this is for a third way out.
 */

import { TextAttributes } from "@opentui/core"
import { useState } from "react"
import { useTheme } from "../context/theme"
import { useBindings } from "../lib/keymap"
import { type DialogContext, type DialogSize, showDialog, useDialog, useDialogPaddingX } from "./dialog"

export interface DialogChoiceOption<V> {
  /** Resolved by {@link DialogChoice.show}; `undefined` reads as a dismissal. */
  readonly value: V | undefined
  readonly label: string
  /** Drawn in `theme.error`. */
  readonly danger?: boolean
}

export function DialogChoice<V>(props: {
  title: string
  message: string
  options: readonly DialogChoiceOption<V>[]
  /** Index focused first. */
  initial?: number
  onPick: (value: V | undefined) => void
}) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const padX = useDialogPaddingX()
  const [active, setActive] = useState(props.initial ?? 0)
  const count = props.options.length

  const commit = (index: number): void => {
    props.onPick(props.options[index]?.value)
    dialog.clear()
  }

  useBindings(() => ({
    bindings: [
      { key: "return", cmd: () => commit(active) },
      // h/l too: there is no text field for the letters to belong to.
      ...(["left", "h"] as const).map((key) => ({ key, cmd: () => setActive((a) => (a + count - 1) % count) })),
      ...(["right", "l"] as const).map((key) => ({ key, cmd: () => setActive((a) => (a + 1) % count) })),
    ],
  }))

  return (
    <box paddingLeft={padX} paddingRight={padX} paddingBottom={1} gap={0}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.title}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <text fg={theme.textMuted}>{props.message}</text>
      <box flexDirection="row" justifyContent="flex-end" paddingTop={1}>
        {props.options.map((option, i) => (
          <box
            key={option.label}
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={i === active ? (option.danger ? theme.error : theme.primary) : undefined}
            onMouseUp={() => commit(i)}
          >
            <text fg={i === active ? theme.selectedListItemText : option.danger ? theme.error : theme.textMuted}>
              {option.label.charAt(0).toUpperCase() + option.label.slice(1)}
            </text>
          </box>
        ))}
      </box>
    </box>
  )
}

DialogChoice.show = <V,>(
  dialog: DialogContext,
  args: {
    title: string
    message: string
    options: readonly DialogChoiceOption<V>[]
    initial?: number
    size?: DialogSize
  },
): Promise<V | undefined> =>
  showDialog<V>(
    dialog,
    (resolve) => (
      <DialogChoice
        title={args.title}
        message={args.message}
        options={args.options}
        initial={args.initial}
        onPick={(value) => resolve(value as V)}
      />
    ),
    { size: args.size ?? "medium" },
  )
