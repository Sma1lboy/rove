/** @jsxImportSource @opentui/react */
/**
 * Answer a task's question (a decision gate): pick one of its options (the
 * recommended one is marked and preselected), optionally add a note, enter
 * sends. A question without options is a note-only dialog. Built from the
 * status picker's `PickerList` and the rename dialog's field, not a new control.
 */

import type { GateInboxDetail } from "@sma1lboy/rove-daemon/daemon/contracts"
import { useState } from "react"
import { clampCursor, isBlankText, stripNewlines } from "../../tui/component/new-task-dialog/state"
import type { PickerWindow } from "../../tui/component/new-task-dialog/state"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { useBindings } from "../lib/keymap"
import { type DialogContext, showDialog, useDialog, useDialogPaddingX } from "../ui/dialog"
import { DialogField, DialogFooter, DialogHeader, DialogSection } from "../ui/dialog-parts"
import { PickerList } from "./new-task-dialog/picker-list"

/** Context is the asking task's own prose; clip it so the dialog stays one screen. */
const CONTEXT_MAX_CHARS = 400

export interface GateAnswerInput {
  readonly option?: string
  readonly text?: string
}

type Field = "options" | "note"

export function GateDecisionDialogView(props: {
  gate: GateInboxDetail
  taskTitle: string
  onSubmit: (answer: GateAnswerInput) => void
  onCancel: () => void
}) {
  const dialog = useDialog()
  const t = useT()
  const padX = useDialogPaddingX()
  const { theme } = useTheme()
  const { options, recommended, question, context } = props.gate
  const hasOptions = options.length > 0

  const [cursor, setCursor] = useState(() =>
    Math.max(
      0,
      options.findIndex((o) => o.key === recommended),
    ),
  )
  const [note, setNote] = useState("")
  const [field, setField] = useState<Field>(hasOptions ? "options" : "note")
  const [error, setError] = useState<string | null>(null)

  function commit(): void {
    const text = note.trim()
    if (!hasOptions && isBlankText(text)) {
      setError(t("gates.decision.needsText"))
      return
    }
    const option = hasOptions ? options[cursor]?.key : undefined
    props.onSubmit({ ...(option !== undefined ? { option } : {}), ...(isBlankText(text) ? {} : { text }) })
    dialog.clear()
  }

  function toggleField(): void {
    if (hasOptions) setField((f) => (f === "options" ? "note" : "options"))
  }

  // The option list has no input cursor or onSubmit, so only while it is
  // focused does it claim up/down and enter; the note field keeps its own.
  useBindings(() => ({
    bindings: [
      { key: "tab", cmd: toggleField },
      { key: "shift+tab", cmd: toggleField },
      ...(field === "options"
        ? [
            { key: "up", cmd: () => setCursor((c) => clampCursor(c - 1, options.length)) },
            { key: "down", cmd: () => setCursor((c) => clampCursor(c + 1, options.length)) },
            { key: "return", cmd: () => commit() },
          ]
        : []),
    ],
  }))

  // Six options at most (the daemon's cap), so the list never needs a window.
  const window: PickerWindow = { items: options.map((o) => o.key), start: 0, total: options.length }
  const rows = options.map((option) => ({
    key: option.key,
    body: `${option.key}  ${option.label}`,
    accent: option.key === recommended,
    dim: option.key === recommended ? t("gates.decision.recommended") : option.detail,
  }))
  const clippedContext =
    context && context.length > CONTEXT_MAX_CHARS ? `${context.slice(0, CONTEXT_MAX_CHARS)}…` : context

  return (
    <box paddingLeft={padX} paddingRight={padX} gap={1}>
      <DialogHeader title={`${t("gates.decision.title")} · ${props.taskTitle}`} onClose={() => props.onCancel()} />
      <text fg={theme.text} wrapMode="word">
        {question}
      </text>
      {clippedContext ? (
        <text fg={theme.textMuted} wrapMode="word">
          {clippedContext}
        </text>
      ) : null}
      {hasOptions ? (
        <DialogSection label={t("gates.decision.optionsLabel")} focused={field === "options"}>
          <PickerList
            window={window}
            cursor={cursor}
            focused={field === "options"}
            rows={rows}
            onPick={(index) => {
              setCursor(index)
              setField("options")
            }}
          />
        </DialogSection>
      ) : null}
      <DialogSection
        label={t("gates.decision.noteLabel")}
        focused={field === "note"}
        hint={hasOptions ? t("gates.decision.noteOptionalHint") : t("gates.decision.noteRequiredHint")}
        onPress={() => setField("note")}
      >
        <DialogField focused={field === "note"}>
          <input
            value={note}
            placeholder={t("gates.decision.notePlaceholder")}
            focused={field === "note"}
            onInput={(v: string) => {
              setNote(stripNewlines(v))
              setError(null)
            }}
            onSubmit={() => commit()}
          />
        </DialogField>
      </DialogSection>
      {error ? (
        <text fg={theme.error} wrapMode="word">
          {error}
        </text>
      ) : null}
      <DialogFooter>
        {hasOptions
          ? field === "options"
            ? t("gates.decision.footerOptions")
            : t("gates.decision.footerNoteWithOptions")
          : t("gates.decision.footerNote")}
      </DialogFooter>
    </box>
  )
}

/** Open the dialog and resolve with the answer — `undefined` on cancel. */
function show(
  dialog: DialogContext,
  opts: { gate: GateInboxDetail; taskTitle: string },
): Promise<GateAnswerInput | undefined> {
  return showDialog<GateAnswerInput>(dialog, (resolve) => (
    <GateDecisionDialogView
      gate={opts.gate}
      taskTitle={opts.taskTitle}
      onSubmit={(answer) => resolve(answer)}
      onCancel={() => resolve(undefined)}
    />
  ))
}

export const GateDecisionDialog = {
  show,
}
