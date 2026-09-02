/** @jsxImportSource @opentui/react */
/**
 * KanbanCard — one issue card on the board. Its own component because it
 * renders ONE card from props and holds no board state: everything about which
 * cards exist, the cursor and the mutations stays in `kanban-page.tsx`.
 * Selection border > attention border > column
 * border; a live activity badge tracks the linked task's engine on both the
 * In-progress and Parked columns (a parked card keeps its badge as passive
 * signal — it just never floats or counts toward "N need you").
 */

import { TextAttributes } from "@opentui/core"
import type { Issue } from "@sma1lboy/kobe-daemon/daemon/issues-store"
import type { ReactNode } from "react"
import type { TaskActivityState } from "../../engine/hook-events"
import { type BoardColumnKey, isBoardAttentionState } from "../../state/issue-board"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { FRAME } from "../ui/frame"

/** Live activity badge on a linked card, keyed by the linked task's engine
 *  state — how the board tracks a background start without leaving the page.
 *  `idle` (and unknown) draw nothing: the card's presence in the column
 *  already says "started". */
const ACTIVITY_BADGE: Partial<
  Record<TaskActivityState, { labelKey: string; tone: "accent" | "warning" | "error" | "success" }>
> = {
  running: { labelKey: "tasks.activity.working", tone: "accent" },
  turn_complete: { labelKey: "kanban.turnComplete", tone: "success" },
  rate_limited: { labelKey: "tasks.activity.rateLimited", tone: "warning" },
  permission_needed: { labelKey: "tasks.activity.permissionNeeded", tone: "warning" },
  error: { labelKey: "tasks.activity.error", tone: "error" },
  dead: { labelKey: "tasks.activity.dead", tone: "error" },
}

export function KanbanCard(props: {
  issue: Issue
  column: BoardColumnKey
  selected: boolean
  /** The linked task's live engine state (undefined = unlinked/vanished). */
  activity: TaskActivityState | undefined
  /** First click selects; a click on the already-selected card opens its
   *  detail drawer (Enter's mouse twin). */
  onSelect: () => void
  onOpen: () => void
}): ReactNode {
  const { theme, transparentBackground } = useTheme()
  const t = useT()
  const { issue, column, selected } = props
  const columnBorder = transparentBackground ? theme.border : theme.borderSubtle
  const fg = column === "done" ? theme.textMuted : theme.text
  const description = issue.body.trim()
  const badge = props.activity ? ACTIVITY_BADGE[props.activity] : undefined
  // Attention cards (blocked on the user — floated to the In-progress head by
  // applyBoardAttention) carry a warning border so the group reads as one
  // block; the selection highlight still wins.
  const needsAttention = isBoardAttentionState(props.activity)
  const badgeTone = {
    accent: theme.accent,
    warning: theme.warning,
    error: theme.error,
    success: theme.success,
  } as const
  // Transparent mode means transparent: the card drops its tinted surface and
  // lets the host terminal through, like every other pane. It used to keep
  // `backgroundElement` on the theory that a card is content rather than
  // chrome — but a solid tile is the one thing on the board that cannot be
  // seen through, so the exception read as the board ignoring the setting.
  // Its border and the column's still separate it from the lane.
  // Horizontal padding only, plus a margin below. `padding={1}` was doing
  // three jobs at once — air inside the card, separation from the next card,
  // and a break between title and description — and paid two rows per card
  // for it. Splitting them keeps all three and buys those rows back: the
  // sides still breathe, `marginBottom` owns the gap between cards (a
  // scrollbox has no `gap` of its own), and the description carries its own
  // top margin.
  return (
    <box
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
      onMouseUp={() => (selected ? props.onOpen() : props.onSelect())}
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
        {badge ? (
          <text fg={badgeTone[badge.tone]} wrapMode="none">
            {t(badge.labelKey)}
          </text>
        ) : null}
      </box>
    </box>
  )
}
