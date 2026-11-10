/** @jsxImportSource @opentui/react */
/**
 * Confirm dialog — yes/no prompt with focused buttons. Left/right (or h/l)
 * switch focus, enter commits, esc cancels via the dialog stack;
 * `DialogConfirm.show(dialog, title, message, label?)` resolves
 * `boolean | undefined` (`undefined` = dismissed without an answer).
 */

import { useT } from "../i18n"
import { type DialogContext, type DialogSize, showDialog } from "./dialog"
import { DialogChoice, type DialogChoiceOption } from "./dialog-choice"

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
  const t = useT()
  const options: DialogChoiceOption<boolean>[] = [
    { value: false, label: props.label ?? t("common.cancel") },
    { value: true, label: props.confirmLabel ?? t("common.confirm"), danger: props.danger },
  ]
  const active = props.initialActive ?? (props.danger ? "cancel" : "confirm")
  return (
    <DialogChoice
      title={props.title}
      message={props.message}
      options={options}
      initial={active === "cancel" ? 0 : 1}
      onPick={(value) => (value ? props.onConfirm?.() : props.onCancel?.())}
    />
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
