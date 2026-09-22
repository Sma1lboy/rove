/** @jsxImportSource @opentui/react */
/**
 * Presentational helpers shared by the settings sections: `Row` and `SubSection`.
 */

import { type BoxRenderable, type RGBA, TextAttributes } from "@opentui/core"
import type { ReactNode } from "react"
import { useTheme } from "../../context/theme"

/**
 * One navigable settings row: cursor row paints `theme.primary` behind
 * `selectedListItemText`; otherwise the caller-computed `fg` over
 * `idleBackground` (undefined = transparent, `backgroundElement` for the
 * button-style Dev/Feedback rows).
 */
export function Row(props: {
  cursor: boolean
  /** `props.rowRef(<this row's body index>)` — cursor-follow registration. */
  rowRef: (r: BoxRenderable | null) => (() => void) | undefined
  onMouseUp: () => void
  /** Foreground when NOT the cursor row (the caller owns that logic). */
  fg: RGBA
  bold?: boolean
  idleBackground?: RGBA
  /**
   * What this option means, muted, on the SAME line as the control. The
   * caller pads the label to line the phrases up.
   */
  hint?: string
  children?: ReactNode
}) {
  const { theme } = useTheme()
  return (
    <box
      ref={props.rowRef}
      flexDirection="row"
      gap={1}
      paddingLeft={1}
      paddingRight={1}
      overflow="hidden"
      backgroundColor={props.cursor ? theme.primary : props.idleBackground}
      onMouseUp={props.onMouseUp}
    >
      <text
        fg={props.cursor ? theme.selectedListItemText : props.fg}
        attributes={props.bold ? TextAttributes.BOLD : undefined}
        wrapMode="none"
      >
        {props.children}
      </text>
      {props.hint ? (
        <text fg={props.cursor ? theme.selectedListItemText : theme.textMuted} wrapMode="none" flexShrink={1}>
          {props.hint}
        </text>
      ) : null}
    </box>
  )
}

/** BOLD section title + word-wrapped muted hint, then the rows. */
export function SubSection(props: { title: string; hint: string; paddingTop?: number; children?: ReactNode }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="column" gap={0} paddingTop={props.paddingTop ?? 1}>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        {props.title}
      </text>
      <text fg={theme.textMuted} wrapMode="word">
        {props.hint}
      </text>
      {props.children}
    </box>
  )
}

/** Shared cursor-plumbing props every section receives from the dialog. */
export type SectionCursorProps = {
  level: "sidebar" | "body"
  bodyRow: number
  setLevel: (level: "sidebar" | "body") => void
  setBodyRow: (row: number) => void
  /**
   * `useCursorFollow`'s `rowRef` for one row, keyed by body index. A prop,
   * not a context, so bare-box sections (Engines, Plugins) register like `Row`.
   */
  rowRef: (row: number) => (r: BoxRenderable | null) => (() => void) | undefined
}
