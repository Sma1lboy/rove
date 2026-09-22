/** @jsxImportSource @opentui/react */
/**
 * Kanban lane geometry: how many lanes fit, lane frame/scroll, and the narrow
 * single-lane strip. Props in, only the selection callbacks out — what a board
 * IS lives in `kanban-page.tsx`.
 */

import { TextAttributes } from "@opentui/core"
import type { Issue } from "@sma1lboy/kobe-daemon/daemon/issues-store"
import type { ReactNode } from "react"
import type { TaskGroup } from "../../lib/task-group"
import type { BoardColumnKey, IssueBoardColumn } from "../../state/issue-board"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import type { CursorFollow } from "../lib/use-cursor-follow"
import { FRAME } from "../ui/frame"
import { KanbanCard } from "./kanban-card"

const COLUMN_LABEL_KEY: Record<BoardColumnKey, string> = {
  backlog: "kanban.column.backlog",
  in_progress: "kanban.column.inProgress",
  parked: "kanban.column.parked",
  done: "kanban.column.done",
}

/**
 * Four-lane width floor in BOARD cells, not `lib/narrow-mode.ts` (a
 * whole-terminal predicate): the sidebar also eats board width — at 100
 * terminal columns the board had 9 cells of card content.
 *
 * Card content needs 12: `YYYY-MM-DD` (10) shares a row with the activity
 * badge. LANE_CHROME per lane = lane border 2 + padding 2 + scrollbar gutter 1
 * + card border 2 + card padding 2.
 */
const MIN_CARD_CELLS = 12
const LANE_CHROME = 9
const BOARD_LANES = 4
/** 4 × (12 + 9) + 3 single-cell gaps = 87. */
const MIN_BOARD_CELLS = BOARD_LANES * (MIN_CARD_CELLS + LANE_CHROME) + (BOARD_LANES - 1)

/** Whether `boardCells` is too tight for four lanes. `null` = not measured yet;
 *  the caller decides what to fall back to. */
export function needsSingleLane(boardCells: number | null): boolean | null {
  return boardCells === null ? null : boardCells < MIN_BOARD_CELLS
}

export interface KanbanBoardProps {
  readonly columns: readonly IssueBoardColumn[]
  /** Cards blocked on the user, counted for the In-progress header. */
  readonly attentionCount: number
  readonly selectedId: number | null
  /** True when four lanes would leave the cards unreadable. */
  readonly singleLane: boolean
  /** The linked task's derived group, per task id — the card badge and the
   *  attention float read the same reader the sidebar's sort does. */
  readonly taskGroupOf?: (taskId: string) => TaskGroup | undefined
  /** Registers each card and each lane so the selection stays in view. */
  readonly follow: CursorFollow<number>
  readonly onSelect: (issueId: number) => void
  readonly onOpen: (issue: Issue) => void
  /** Right-click on a card, with the click's screen cell — the page owns the
   *  menu's state and its verbs, the board only reports where it landed. */
  readonly onCardContextMenu?: (issue: Issue, x: number, y: number) => void
}

export function KanbanBoard(props: KanbanBoardProps): ReactNode {
  const { theme, transparentBackground } = useTheme()
  const t = useT()
  const columnBorder = transparentBackground ? theme.border : theme.borderSubtle
  const { columns, selectedId } = props

  const columnAccent = {
    backlog: theme.textMuted,
    in_progress: theme.accent,
    parked: theme.warning,
    done: theme.success,
  } satisfies Record<BoardColumnKey, unknown>

  function card(issue: Issue, column: BoardColumnKey): ReactNode {
    // Only In progress floats/counts the badge; Parked shows it passively.
    const live = column === "in_progress" || column === "parked"
    const group = live && issue.taskId ? props.taskGroupOf?.(issue.taskId) : undefined
    return (
      <KanbanCard
        key={issue.id}
        issue={issue}
        column={column}
        selected={issue.id === selectedId}
        group={group}
        onSelect={() => props.onSelect(issue.id)}
        onOpen={() => props.onOpen(issue)}
        onContextMenu={props.onCardContextMenu ? (x, y) => props.onCardContextMenu?.(issue, x, y) : undefined}
        boxRef={props.follow.rowRef(issue.id)}
      />
    )
  }

  function lane(col: IssueBoardColumn, opts?: { header?: boolean }): ReactNode {
    return (
      <box
        key={col.key}
        flexGrow={1}
        flexBasis={0}
        // See ui/frame.ts for why this is spread.
        {...FRAME}
        borderColor={columnBorder}
        paddingLeft={1}
        paddingRight={1}
      >
        {(opts?.header ?? true) ? (
          <box flexDirection="row" justifyContent="space-between">
            <text fg={columnAccent[col.key]} attributes={TextAttributes.BOLD} wrapMode="none">
              {t(COLUMN_LABEL_KEY[col.key])} ({col.issues.length + col.hiddenCount})
            </text>
            {col.key === "in_progress" && props.attentionCount > 0 ? (
              <text fg={theme.warning} attributes={TextAttributes.BOLD} wrapMode="none">
                {t("kanban.attention", { count: String(props.attentionCount) })}
              </text>
            ) : null}
          </box>
        ) : null}
        {/* paddingRight keeps a one-cell gutter under the scrollbar thumb —
            without it the thumb paints over the cards' right borders. The
            horizontal bar is hidden outright: a lane never scrolls sideways. */}
        <scrollbox
          ref={props.follow.scrollRef}
          flexGrow={1}
          paddingTop={1}
          paddingRight={1}
          verticalScrollbarOptions={{ showArrows: false, trackOptions: { foregroundColor: "transparent" } }}
          horizontalScrollbarOptions={{ visible: false }}
        >
          {col.issues.map((issue) => card(issue, col.key))}
          {col.issues.length === 0 && col.hiddenCount === 0 ? (
            <text fg={theme.textMuted} wrapMode="none">
              {t("kanban.columnEmpty")}
            </text>
          ) : null}
          {col.hiddenCount > 0 ? (
            <text fg={theme.textMuted} wrapMode="none">
              {t("kanban.more", { count: String(col.hiddenCount) })}
            </text>
          ) : null}
        </scrollbox>
      </box>
    )
  }

  /** Narrow: the selection's lane full-width under a strip of lane counts;
   *  the visible lane follows the selection. Clicking a lane selects its
   *  first card. */
  function singleLaneBoard(): ReactNode {
    const active =
      columns.find((col) => col.issues.some((issue) => issue.id === selectedId)) ??
      columns.find((col) => col.issues.length > 0) ??
      columns[0]
    if (!active) return null
    return (
      <box flexDirection="column" flexGrow={1} paddingTop={1}>
        <box flexDirection="row" gap={2}>
          {columns.map((col) => (
            <text
              key={col.key}
              fg={col.key === active.key ? columnAccent[col.key] : theme.textMuted}
              attributes={col.key === active.key ? TextAttributes.BOLD : undefined}
              wrapMode="none"
              onMouseUp={() => {
                const first = col.issues[0]
                if (first) props.onSelect(first.id)
              }}
            >
              {t(COLUMN_LABEL_KEY[col.key])} ({col.issues.length + col.hiddenCount})
            </text>
          ))}
        </box>
        {/* The strip above already names the active lane — the in-column
            header would repeat it one row later. Blocked cards still read:
            the attention float pins them to the top with warning borders. */}
        {lane(active, { header: false })}
      </box>
    )
  }

  if (props.singleLane) return singleLaneBoard()
  return (
    <box flexDirection="row" gap={1} flexGrow={1} paddingTop={1}>
      {columns.map((col) => lane(col))}
    </box>
  )
}
