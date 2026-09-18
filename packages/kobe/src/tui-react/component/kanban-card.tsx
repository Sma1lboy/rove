/** @jsxImportSource @opentui/react */
/**
 * KanbanCard — one issue card on the board. Its own component because it
 * renders ONE card from props and holds no board state: everything about which
 * cards exist, the cursor and the mutations stays in `kanban-page.tsx`.
 * Selection border > attention border > column
 * border; a badge naming the linked task's DERIVED group shows on both the
 * In-progress and Parked columns (a parked card keeps its badge as passive
 * signal — it just never floats or counts toward "N need you").
 */

import { type BoxRenderable, MouseButton, TextAttributes } from "@opentui/core"
import type { Issue } from "@sma1lboy/kobe-daemon/daemon/issues-store"
import type { ReactNode } from "react"
import type { TaskGroup } from "../../lib/task-group"
import type { BoardColumnKey } from "../../state/issue-board"
import { taskGroupLabel, taskGroupTone } from "../../tui/panes/sidebar/task-group-view"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { FRAME } from "../ui/frame"

/**
 * The card's badge is the linked task's DERIVED group (`lib/task-group.ts`),
 * not its raw engine state.
 *
 * The board used to key this off activity alone, which made it answer the
 * wrong question in two directions: a card whose worker had already filed a
 * report and gone quiet read as ordinary work in progress, and so did one
 * whose PR had been approved an hour ago. Both are cards the human should
 * act on, and neither is visible in any tab's engine state.
 *
 * `idle` and `unknown` still draw nothing — the card's presence in the column
 * already says "started", and a group with nothing for a person says so by
 * being silent.
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
  /** Right-click, with the click's screen cell — the board's one-step route
   *  out of a column (the sidebar's task rows already offer the same). */
  onContextMenu?: (x: number, y: number) => void
  /** Registers the card with the board's cursor-follow so the selected card
   *  can be scrolled into its lane's viewport. */
  boxRef?: (r: BoxRenderable | null) => (() => void) | undefined
}): ReactNode {
  const { theme, transparentBackground } = useTheme()
  const t = useT()
  const { issue, column, selected } = props
  const columnBorder = transparentBackground ? theme.border : theme.borderSubtle
  const fg = column === "done" ? theme.textMuted : theme.text
  const description = issue.body.trim()
  const badgeLabel = props.group ? taskGroupLabel(props.group) : null
  const badgeTone = props.group ? taskGroupTone(props.group) : null
  // Attention cards (blocked on the user — floated to the In-progress head by
  // applyBoardAttention) carry a warning border so the group reads as one
  // block; the selection highlight still wins.
  const needsAttention = props.group === "waiting-on-you"
  const toneColors = {
    accent: theme.accent,
    warning: theme.warning,
    error: theme.error,
    success: theme.success,
    primary: theme.primary,
    textMuted: theme.textMuted,
  } as const
  // Transparent mode means transparent: the card drops its tinted surface and
  // lets the host terminal through, like every other pane. Keeping
  // `backgroundElement` on the theory that a card is content rather than
  // chrome would make it the one thing on the board you cannot see through,
  // which reads as the board ignoring the setting. Its border and the
  // column's still separate it from the lane.
  // Horizontal padding only, plus a margin below. `padding={1}` was doing
  // three jobs at once — air inside the card, separation from the next card,
  // and a break between title and description — and paid two rows per card
  // for it. Splitting them keeps all three and buys those rows back: the
  // sides still breathe, `marginBottom` owns the gap between cards (a
  // scrollbox has no `gap` of its own), and the description carries its own
  // top margin.
  return (
    <box
      ref={props.boxRef}
      // Rounded to match the column that holds it — a square card inside a
      // rounded column reads as two different systems one cell apart.
      {...FRAME}
      borderColor={selected ? theme.primary : needsAttention ? theme.warning : columnBorder}
      backgroundColor={transparentBackground ? "transparent" : theme.backgroundElement}
      paddingLeft={1}
      paddingRight={1}
      // The lane's separator. On the LAST card it is dead space inside the
      // scroll region rather than a gap anyone sees, which is the cheaper
      // wrong than a per-card conditional that has to know its own index.
      marginBottom={1}
      // A right-click opens the menu on ANY card, selected or not, and never
      // falls through to select/open — the same rule the sidebar's rows
      // follow, so one gesture means one thing across both surfaces.
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
      {/* Two-line preview is deliberate card grammar: enough room for a
          description now, with a stable region for the future editor. The top
          margin is what the card's vertical padding used to provide: without
          it the description runs straight on from the title and the two read
          as one wrapped paragraph. */}
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
