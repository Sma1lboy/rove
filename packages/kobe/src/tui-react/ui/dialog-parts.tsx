/** @jsxImportSource @opentui/react */
/**
 * The "story editor" dialog grammar as components (caps labels, rounded field
 * wells, chips, a key legend); see `docs/design/dialogs.md`. `ui/dialog.tsx`
 * owns the card itself. Compose these rather than re-deriving the look.
 */

import type { BoxRenderable, RGBA } from "@opentui/core"
import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/react"
import type { ReactNode } from "react"
import { useTheme } from "../context/theme"
import { useDialogFocus } from "./dialog-body"
import { FRAME } from "./frame"

/** Short terminals omit borders to leave more rows for editable values.
 * Scrolling forms still keep their header and actions outside the body. */
const FRAMED_DIALOG_MIN_ROWS = 34

/** Is the viewport too short to spend two rows per field on a border? */
function useDialogCompact(): boolean {
  return useTerminalDimensions().height < FRAMED_DIALOG_MIN_ROWS
}

/** Field-well fill; transparent in transparent mode too. */
function useFieldFill(): RGBA | "transparent" {
  const { theme, transparentBackground } = useTheme()
  return transparentBackground ? "transparent" : theme.backgroundElement
}

/** Top row: title (or `children` for a richer header) left, `esc` right. */
export function DialogHeader(props: { title?: string; children?: ReactNode; onClose: () => void }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
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

/** Field label: BOLD, muted until focused, then primary + underlined; `hint` trails it muted. */
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

/** A field's well: rounded border; one cell of padding keeps the caret off the border. */
export function DialogField(props: { focused: boolean; children?: ReactNode; paddingBottom?: number }) {
  const { theme } = useTheme()
  const fill = useFieldFill()
  // Compact: indented to where the border would be, to line up under the label.
  if (useDialogCompact()) {
    return (
      <box paddingLeft={2} paddingBottom={props.paddingBottom} flexShrink={0}>
        {props.children}
      </box>
    )
  }
  return (
    <box
      {...FRAME}
      flexShrink={0}
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
  const focus = useDialogFocus<BoxRenderable>(props.focused)
  return (
    <box {...focus} gap={0} paddingBottom={props.paddingBottom} flexShrink={0}>
      <DialogLabel label={props.label} focused={props.focused} hint={props.hint} onPress={props.onPress} />
      {props.children}
    </box>
  )
}

/**
 * The dialog's one button shape: bordered, PRIMARY + BOLD when selected. No
 * fill: border cells share the parent's background, so a fill halos around
 * the border line.
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
      flexShrink={1}
      truncate
    >
      {props.label}
    </text>
  )
  // Compact: `▸ ` carries the selection a border would have shown.
  if (useDialogCompact()) {
    return (
      <box flexDirection="row" flexShrink={0} maxWidth="100%" onMouseUp={props.onPress}>
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
      flexShrink={0}
      maxWidth="100%"
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

/** The ONLY pick-one-value control: {@link ChipButton}s side by side, wrapping by whole chips. */
export function ChipRow<T extends string>(props: {
  choices: readonly T[]
  selected: T
  onPick: (choice: T) => void
  /** Display text for a choice (default: the choice itself). */
  display?: (choice: T) => string
  paddingBottom?: number
}) {
  // columnGap, not gap: `gap` would also add a blank row between wrapped lines.
  return (
    <box flexDirection="row" flexWrap="wrap" alignItems="flex-start" columnGap={1} rowGap={0} flexShrink={0}>
      {props.choices.map((choice) => (
        <ChipButton
          key={choice}
          label={props.display ? props.display(choice) : choice}
          selected={choice === props.selected}
          onPress={() => props.onPick(choice)}
          {...(props.paddingBottom === undefined ? {} : { paddingBottom: props.paddingBottom })}
        />
      ))}
    </box>
  )
}

/** The muted key legend every dialog ends with; carries its own bottom cell
 *  since the card owns only `paddingTop`. */
export function DialogFooter(props: { children?: ReactNode; paddingBottom?: number }) {
  const { theme } = useTheme()
  return (
    <box paddingBottom={props.paddingBottom ?? 1} flexShrink={0}>
      <text fg={theme.textMuted} wrapMode="word">
        {props.children}
      </text>
    </box>
  )
}

/**
 * Bottom-right `[ action ]` for a dialog with a focusable confirm field.
 * Focus adds a `▸ ` caret too, for terminals with colour off. A dialog that
 * commits from any field states the verb in its legend instead.
 */
export function DialogActions(props: { label: string; focused: boolean; onPress: () => void; paddingTop?: number }) {
  const { theme } = useTheme()
  return (
    <box
      flexDirection="row"
      justifyContent="flex-end"
      alignItems="center"
      paddingTop={props.paddingTop ?? 1}
      paddingBottom={1}
      flexShrink={0}
    >
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
