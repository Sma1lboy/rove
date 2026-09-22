/** @jsxImportSource @opentui/react */
/**
 * One issue card, props only; board state lives in `kanban-page.tsx`.
 * Border: selection > attention > column. The derived-group badge shows on
 * In-progress and Parked; a parked card never floats or counts toward
 * "N need you".
 */

import { type BoxRenderable, MouseButton, TextAttributes } from "@opentui/core"
import type { Issue } from "@sma1lboy/kobe-daemon/daemon/issues-store"
import type { ReactNode } from "react"
import type { TaskGroup } from "../../lib/task-group"
import type { BoardColumnKey } from "../../state/issue-board"
import { taskGroupLabel, taskGroupTone } from "../../tui/panes/sidebar/task-group-view"
import { useTheme } from "../context/theme"
import { FRAME } from "../ui/frame"

/**
 * The badge is the linked task's DERIVED group (`lib/task-group.ts`), not raw
 * engine state: a quiet worker that filed a report, or an approved PR, needs
 * the human but looks idle to the engine. `idle`/`unknown` draw nothing.
 */

export function KanbanCard(props: {
  issue: Issue
  column: BoardColumnKey
  selected: boolean
  /** The linked task's derived group (undefined = unlinked/vanished). */
  group: TaskGroup | undefined
  /** First click selects; a click on the already-selected card opens its
   *  detail drawer (Enter's mouse twin). */
  onSelect: () => void
  onOpen: () => void
  /** Right-click, with the click's screen cell. */
  onContextMenu?: (x: number, y: number) => void
  /** Registers the card with the board's cursor-follow so the selected card
   *  can be scrolled into its lane's viewport. */
  boxRef?: (r: BoxRenderable | null) => (() => void) | undefined
}): ReactNode {
  const { theme, transparentBackground } = useTheme()
  const { issue, column, selected } = props
  const columnBorder = transparentBackground ? theme.border : theme.borderSubtle
  const fg = column === "done" ? theme.textMuted : theme.text
  const description = issue.body.trim()
  const badgeLabel = props.group ? taskGroupLabel(props.group) : null
  const badgeTone = props.group ? taskGroupTone(props.group) : null
  // Attention cards (floated by applyBoardAttention) get a warning border so
  // the group reads as one block; selection still wins.
  const needsAttention = props.group === "waiting-on-you"
  const toneColors = {
    accent: theme.accent,
    warning: theme.warning,
    error: theme.error,
    success: theme.success,
    primary: theme.primary,
    textMuted: theme.textMuted,
  } as const
  // Transparent mode drops the card's surface too, else it's the one opaque
  // thing on the board; borders still separate it.
  // Horizontal padding only: vertical padding cost two rows per card.
  // `marginBottom` is the inter-card gap (a scrollbox has no `gap`).
  return (
    <box
      ref={props.boxRef}
      // Rounded to match its column.
      {...FRAME}
      borderColor={selected ? theme.primary : needsAttention ? theme.warning : columnBorder}
      backgroundColor={transparentBackground ? "transparent" : theme.backgroundElement}
      paddingLeft={1}
      paddingRight={1}
      // Dead space on the last card; cheaper than an index conditional.
      marginBottom={1}
      // Right-click opens the menu on any card and never falls through to
      // select/open — same rule as the sidebar's rows.
      onMouseUp={(evt: { button: number; x: number; y: number }) => {
        if (evt.button === MouseButton.RIGHT && props.onContextMenu) {
          props.onContextMenu(evt.x, evt.y)
          return
        }
        if (selected) props.onOpen()
        else props.onSelect()
      }}
    >
      <box flexDirection="row" justifyContent="space-between">
        <text fg={fg} attributes={TextAttributes.BOLD} wrapMode="word" flexShrink={1}>
          {issue.title}
        </text>
        {/* paddingLeft keeps a cell of air when a wrapped title line runs
            the full row — space-between alone let it read as `title#12`. */}
        <text fg={theme.textMuted} wrapMode="none" flexShrink={0} paddingLeft={1}>
          #{issue.id}
        </text>
      </box>
      {/* Fixed two-line preview: a stable region whether or not the issue has a description. */}
      <box height={2} overflow="hidden">
        {description ? (
          <text fg={theme.textMuted} wrapMode="word">
            {description}
          </text>
        ) : null}
      </box>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted} wrapMode="none">
          {issue.created}
        </text>
        {badgeLabel && badgeTone ? (
          <text fg={toneColors[badgeTone]} wrapMode="none">
            {badgeLabel}
          </text>
        ) : null}
      </box>
    </box>
  )
}
