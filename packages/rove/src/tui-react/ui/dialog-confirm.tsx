/** @jsxImportSource @opentui/react */
/**
 * Confirm dialog — yes/no prompt with focused buttons. Left/right (or h/l)
 * switch focus, enter commits, esc cancels via the dialog stack;
 * `DialogConfirm.show(dialog, title, message, label?)` resolves
 * `boolean | undefined` (`undefined` = dismissed without an answer).
 */

import { TextAttributes } from "@opentui/core"
import { useState } from "react"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { useBindings } from "../lib/keymap"
import { type DialogContext, type DialogSize, showDialog, useDialog, useDialogPaddingX } from "./dialog"

function titlecase(s: string): string {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export type DialogConfirmProps = {
  title: string
  message: string
  onConfirm?: () => void
  onCancel?: () => void
  /** Custom label for the cancel button (default: `cancel`). Titlecased on render. */
  label?: string
  /** Custom label for the confirm button (default: `confirm`). Titlecased on render. */
  confirmLabel?: string
  /** Destructive: initial focus on Cancel (a stray Enter must not commit) and
   *  confirm drawn in `theme.error`. */
  danger?: boolean
  /** Which button receives initial keyboard focus (default: `confirm`, or `cancel` when `danger`). */
  initialActive?: "confirm" | "cancel"
}

export type DialogConfirmResult = boolean | undefined
type DialogConfirmOptions = {
  danger?: boolean
  initialActive?: "confirm" | "cancel"
  /** Card width when `small` (50 cells) is too narrow to show what will run. */
  size?: DialogSize
}

export function DialogConfirm(props: DialogConfirmProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const t = useT()
  const padX = useDialogPaddingX()
  const [active, setActive] = useState<"confirm" | "cancel">(
    props.initialActive ?? (props.danger ? "cancel" : "confirm"),
  )

  useBindings(() => ({
    bindings: [
      {
        key: "return",
        cmd: () => {
          if (active === "confirm") props.onConfirm?.()
          if (active === "cancel") props.onCancel?.()
          dialog.clear()
        },
      },
      // h/l too: there is no text field for the letters to belong to.
      ...(["left", "h", "right", "l"] as const).map((key) => ({
        key,
        cmd: () => setActive((a) => (a === "confirm" ? "cancel" : "confirm")),
      })),
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
        {(["cancel", "confirm"] as const).map((key) => {
          // Danger: active fill and idle label both use the error color.
          const dangerConfirm = key === "confirm" && props.danger
          return (
            <box
              key={key}
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={key === active ? (dangerConfirm ? theme.error : theme.primary) : undefined}
              onMouseUp={() => {
                if (key === "confirm") props.onConfirm?.()
                if (key === "cancel") props.onCancel?.()
                dialog.clear()
              }}
            >
              <text fg={key === active ? theme.selectedListItemText : dangerConfirm ? theme.error : theme.textMuted}>
                {titlecase(
                  key === "cancel" ? (props.label ?? t("common.cancel")) : (props.confirmLabel ?? t("common.confirm")),
                )}
              </text>
            </box>
          )
        })}
      </box>
    </box>
  )
}

DialogConfirm.show = (
  dialog: DialogContext,
  title: string,
  message: string,
  label?: string,
  confirmLabel?: string,
  options?: DialogConfirmOptions,
): Promise<DialogConfirmResult> => {
  return showDialog<boolean>(
    dialog,
    (resolve) => (
      <DialogConfirm
        title={title}
        message={message}
        onConfirm={() => resolve(true)}
        onCancel={() => resolve(false)}
        label={label}
        confirmLabel={confirmLabel}
        danger={options?.danger}
        initialActive={options?.initialActive}
      />
    ),
    { size: options?.size ?? "small" },
  )
}
