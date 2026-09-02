/** @jsxImportSource @opentui/react */
/**
 * The one dialog grammar, as components — see `docs/design/dialogs.md`.
 *
 * `ui/dialog.tsx` owns the CARD (size, placement, dimmer, esc barrier); this
 * file owns what goes inside it. The card admits two looks — a "form sheet"
 * (New task, New routine, the pickers — lowercase labels, bare inputs,
 * `[ create ]` bottom-right) and a "story editor" (the kanban drawer — caps
 * labels, rounded field wells, chips, a key legend) — and which one a dialog
 * wears must not depend on what its author happened to have open.
 *
 * The pieces here are the story-editor half, so a dialog gets the grammar by
 * composing rather than by remembering. In particular
 * {@link DialogField} spreads {@link FRAME}: a well is rounded because the
 * author used the shared component, not because they recalled that opentui
 * defaults `borderStyle` to square (`ui/frame.ts`).
 */

import type { RGBA } from "@opentui/core"
import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/react"
import type { ReactNode } from "react"
import { useTheme } from "../context/theme"
import { FRAME } from "./frame"

/**
 * Below this many terminal rows, framed pieces drop their border.
 *
 * A well and a chip each cost TWO rows the text inside them does not need,
 * and the card is capped at the viewport with nothing to scroll it — the new
 * task dialog's Clone tab carries four fields plus a picker, and at 24 rows
 * the frames pushed the Create button and `submitError` off the bottom.
 * That is the failure `new-task-short-terminal.test.tsx` exists to catch: a
 * failed create rendering into rows that do not exist reads as nothing
 * happening at all.
 *
 * So the border is what gives way, not the button. The value is the smallest
 * viewport that still fits the tallest card WITH its frames (measured on the
 * Clone tab, four wells + engine chips + a two-row picker); anything shorter
 * gets the same fields, unframed.
 */
const FRAMED_DIALOG_MIN_ROWS = 34

/** Is the viewport too short to spend two rows per field on a border? */
export function useDialogCompact(): boolean {
  return useTerminalDimensions().height < FRAMED_DIALOG_MIN_ROWS
}

/**
 * Fill for a field well. Transparent mode means transparent here too — the
 * dialog wells were the last solid tiles left on screen with the setting on.
 */
export function useFieldFill(): RGBA | "transparent" {
  const { theme, transparentBackground } = useTheme()
  return transparentBackground ? "transparent" : theme.backgroundElement
}

/**
 * Top row: what the dialog IS on the left, the `esc` affordance on the
 * right. `title` covers the common case; `children` replaces it for a header
 * that carries more than a name (the story drawer's id + status + created).
 */
export function DialogHeader(props: { title?: string; children?: ReactNode; onClose: () => void }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="row" justifyContent="space-between">
      {props.children ?? (
        <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none">
          {props.title}
        </text>
      )}
      <text fg={theme.textMuted} wrapMode="none" onMouseUp={props.onClose}>
        esc
      </text>
    </box>
  )
}

/**
 * Field label: BOLD, muted until its field takes focus, then primary +
 * underlined. `hint` trails it in muted text — the arrow keys a selector
 * answers to (`←/→`), or a note about what the field accepts.
 */
export function DialogLabel(props: { label: string; focused: boolean; hint?: string; onPress?: () => void }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="row" gap={2}>
      <text
        fg={props.focused ? theme.primary : theme.textMuted}
        attributes={props.focused ? TextAttributes.BOLD | TextAttributes.UNDERLINE : TextAttributes.BOLD}
        wrapMode="none"
        onMouseUp={props.onPress}
      >
        {props.label}
      </text>
      {props.hint ? (
        <text fg={theme.textMuted} wrapMode="none">
          {props.hint}
        </text>
      ) : null}
    </box>
  )
}

/**
 * The well a field's input sits in: rounded border, subtle until focused.
 * One cell of horizontal padding so the caret never touches the border line.
 */
export function DialogField(props: { focused: boolean; children?: ReactNode; paddingBottom?: number }) {
  const { theme } = useTheme()
  const fill = useFieldFill()
  // Compact: the well's one row of content, indented to where the border
  // would have put it, so the field still lines up under its label.
  if (useDialogCompact()) {
    return (
      <box paddingLeft={2} paddingBottom={props.paddingBottom}>
        {props.children}
      </box>
    )
  }
  return (
    <box
      {...FRAME}
      borderColor={props.focused ? theme.primary : theme.borderSubtle}
      backgroundColor={fill}
      paddingLeft={1}
      paddingRight={1}
      {...(props.paddingBottom === undefined ? {} : { paddingBottom: props.paddingBottom })}
    >
      {props.children}
    </box>
  )
}

/** Label + its content, tight (`gap={0}`) so the two read as one field. */
export function DialogSection(props: {
  label: string
  focused: boolean
  hint?: string
  onPress?: () => void
  children?: ReactNode
  paddingBottom?: number
}) {
  return (
    <box gap={0} paddingBottom={props.paddingBottom}>
      <DialogLabel label={props.label} focused={props.focused} hint={props.hint} onPress={props.onPress} />
      {props.children}
    </box>
  )
}

/**
 * The dialog's one button shape: a bordered box that lights up PRIMARY +
 * BOLD when it is the selected/focused choice.
 *
 * No fill on purpose: border cells share the parent box's background, so a
 * `backgroundElement` fill halos AROUND the border line. The primary border
 * plus bold text alone mark selection.
 */
export function ChipButton(props: {
  label: string
  selected: boolean
  onPress: () => void
  /** Colour when NOT selected: `muted` for a picker option (default), `text`
   *  for an action meant to stay readable while focus is elsewhere. */
  tone?: "muted" | "text"
  paddingBottom?: number
}) {
  const { theme } = useTheme()
  const label = (
    <text
      fg={props.selected ? theme.primary : props.tone === "text" ? theme.text : theme.textMuted}
      attributes={props.selected ? TextAttributes.BOLD : undefined}
      wrapMode="none"
      flexShrink={0}
    >
      {props.label}
    </text>
  )
  // Compact: `▸ ` carries the selection a border would have shown.
  if (useDialogCompact()) {
    return (
      <box flexDirection="row" flexShrink={0} onMouseUp={props.onPress}>
        <text fg={props.selected ? theme.primary : theme.textMuted} wrapMode="none">
          {props.selected ? "▸ " : "  "}
        </text>
        {label}
      </box>
    )
  }
  return (
    <box
      {...FRAME}
      borderColor={props.selected ? theme.primary : theme.borderSubtle}
      paddingLeft={2}
      paddingRight={2}
      {...(props.paddingBottom === undefined ? {} : { paddingBottom: props.paddingBottom })}
      onMouseUp={props.onPress}
    >
      {label}
    </box>
  )
}

/**
 * The key legend every dialog closes with — one muted line naming the keys
 * that dialog answers to. The card owns only `paddingTop`, so the last row
 * has to carry its own bottom cell or it sits flush against the card's edge.
 */
export function DialogFooter(props: { children?: ReactNode }) {
  const { theme } = useTheme()
  return (
    <box paddingBottom={1}>
      <text fg={theme.textMuted} wrapMode="word">
        {props.children}
      </text>
    </box>
  )
}

/**
 * Bottom-right `[ action ]`, for a dialog whose commit has a focusable
 * confirm field. Focus adds a `▸ ` caret as well as the primary accent —
 * a terminal with colour turned off still has to show where enter goes. A dialog that commits with Enter from any field (the story
 * drawer) has no such field and states the verb in its legend instead — a
 * button nothing can focus would be a fourth thing to explain.
 */
export function DialogActions(props: { label: string; focused: boolean; onPress: () => void }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="row" justifyContent="flex-end" alignItems="center" paddingTop={1} paddingBottom={1}>
      <text
        fg={props.focused ? theme.primary : theme.text}
        attributes={props.focused ? TextAttributes.BOLD : undefined}
        wrapMode="none"
        onMouseUp={props.onPress}
      >
        {`${props.focused ? "▸ " : ""}[ ${props.label} ]`}
      </text>
    </box>
  )
}
