/** @jsxImportSource @opentui/react */
/**
 * The Kanban board's LANE GEOMETRY — how many lanes fit, how one is framed and
 * scrolled, and the narrow single-lane strip. Split out of `kanban-page.tsx`,
 * which keeps the other job: fetching boards, owning the selection, and running
 * the dialogs and mutations behind `enter` / `n` / `d`.
 *
 * The seam is "does a card fit" versus "what is on the card". Everything here
 * reads its inputs from props and writes nothing back except the two selection
 * callbacks, so the page can change what a board IS without touching how it is
 * laid out, and this file can change the breakpoint without knowing what a
 * story is.
 */

import { TextAttributes } from "@opentui/core"
import type { Issue } from "@sma1lboy/kobe-daemon/daemon/issues-store"
import type { ReactNode } from "react"
import type { TaskEngineState } from "../../client/remote-orchestrator"
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
 * Width floor for the four-lane layout, in cells of the BOARD — deliberately
 * not `lib/narrow-mode.ts`. That module's 70 columns is a whole-terminal
 * predicate (does the three-pane desktop layout fit at all); this one asks a
 * narrower question the sidebar's width also answers to: does a lane still hold
 * a readable card. At 100 terminal columns the desktop layout is fine and the
 * board still had 9 cells of card content.
 *
 * A card's own content needs 12: `issue.created` is `YYYY-MM-DD` at 10 cells
 * and the activity badge shares that row. LANE_CHROME is what stands between
 * the board's width and that content, per lane — lane border 2 + lane padding
 * 2 + the scrollbar gutter 1 + card border 2 + card padding 2.
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
  /** Per-task engine activity — the live badge on a linked card. */
  readonly engineStates?: ReadonlyMap<string, TaskEngineState>
  /** Registers each card and each lane so the selection stays in view. */
  readonly follow: CursorFollow<number>
  readonly onSelect: (issueId: number) => void
  readonly onOpen: (issue: Issue) => void
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
    // Linked cards in the live lanes track their task's engine activity (the
    // stay-on-the-board half of the background-start trigger); only In
    // progress floats/counts the badge, Parked keeps it as passive signal.
    const live = column === "in_progress" || column === "parked"
    const activity = live && issue.taskId ? props.engineStates?.get(issue.taskId)?.state : undefined
    return (
      <KanbanCard
        key={issue.id}
        issue={issue}
        column={column}
        selected={issue.id === selectedId}
        activity={activity}
        onSelect={() => props.onSelect(issue.id)}
        onOpen={() => props.onOpen(issue)}
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
        // Rounded like every other framed surface — see ui/frame.ts for why
        // this is spread rather than written out.
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

  /** Narrow: one full-width lane (the selection's column) under a strip of
   *  the other lanes' counts; ←/→ moves selection across lanes, and the
   *  visible column follows it. Clicking a lane jumps to its first card. */
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
