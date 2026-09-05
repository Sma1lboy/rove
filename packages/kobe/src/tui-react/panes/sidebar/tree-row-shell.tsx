/** @jsxImportSource @opentui/react */
/**
 * The chrome every tree row sits in, and the cell arithmetic each row budgets
 * its label against.
 *
 * Split out of `tree-rows.tsx` because the two halves answer different
 * questions: this one is "what does ANY row look like, and how much width is
 * left for a label", while the row kinds next door are "what does a worktree
 * / tab / routines / recent-jump row put in that space". `RowShell` owns the
 * marker column, the indent, and the whole mouse contract; the budget helpers
 * own the reserved cells the right-edge cluster spends.
 */

import type { TaskEngineState, TaskJobState } from "@/client/remote-orchestrator"
import { type BoxRenderable, MouseButton } from "@opentui/core"
import type { ReactNode } from "react"
import { charWidth } from "../../../lib/display-width"
import { taskJumpDigit } from "../../../tui/panes/sidebar/jump-digits"
import { SIDEBAR_WIDTH } from "../../../tui/panes/sidebar/view-core"
import type { WorktreeChanges } from "../../../tui/panes/sidebar/worktree-changes"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import { resolveRowSelectionChrome } from "../../ui/row-selection-chrome"

/** Cells of indent per depth level — one: the rail is narrow, and the glyph
 *  column already separates the levels visually. */
const INDENT_CELLS = 1

export type TreeRowShared = {
  /** Rail width in cells — the label truncation budget derives from it. */
  readonly width?: number
  /** Cursor position in the tree's flat id list. */
  readonly cursorIndex: number
  /** The row id the right pane is showing (`taskId::tabId` when a tab). */
  readonly activeRowId: string | null
  /** The task whose session the right pane shows. The unread-lamp digest
   *  keys on THIS (selected task + the tab's own active bit) rather than on
   *  `activeRowId`: that id needs the live tab map, which is cold right
   *  after a restart — and a lamp that ignores the session you are sitting
   *  in is wrong. */
  readonly selectedTaskId: string | null
  /** The row being dragged in move mode — wears the move chip.
   *  Null outside move mode, and while a `main` row drags its whole project
   *  (the group HEADER wears the chip then — `movingProjectId`). */
  readonly movingRowId?: string | null
  /** Keyed by FLAT INDEX so one scroll-follow lookup covers every row. */
  readonly rowEls: Map<number, BoxRenderable>
  readonly onPress: (flatIndex: number, rowId: string) => void
  /** Right-click. Absent = right-click falls through to a plain activate. */
  readonly onContextMenu?: (flatIndex: number, rowId: string, x: number, y: number) => void
  /** The sidebar's ~2s poll tick — drives the ±stats poller. */
  readonly branchTick: number
  readonly engineState?: ReadonlyMap<string, TaskEngineState>
  /** Per-tab activity (taskId → tabId → state) — the precise signal for a
   *  tab row; `engineState` is the task-level rollup fallback. */
  readonly engineTabState?: ReadonlyMap<string, ReadonlyMap<string, TaskEngineState>>
  readonly engineLifecycle?: ReadonlyMap<string, { readonly subagents: number }>
  readonly taskJobs?: ReadonlyMap<string, TaskJobState>
  readonly worktreeChanges?: ReadonlyMap<string, WorktreeChanges | null> | null
  /** Daemon-collected transcript facts keyed by WORKTREE path. A tab row
   *  needs them to tell a finished turn from one whose engine is still
   *  writing in hook silence (`stillWorkingAfterCompletion`) — without it
   *  every `turn_complete` reads as done the moment the hook fires. */
  readonly transcriptActivity?: ReadonlyMap<string, { readonly mtimeMs: number }> | null
}

/**
 * Cell budget for a tree row's flexible label, so a clipped label ends in a
 * visible `…` instead of the bare hard cut Yoga produces (a chopped branch
 * name reads as the full name to anyone who doesn't know it's longer). The
 * caller passes the LIVE right-edge cluster width — same per-row subtraction
 * the flat cards do — and each cluster item costs its width plus its 1-cell
 * flex gap. Slight over-budget is safe (flex still clips); the floor keeps a
 * crowded row from erasing its label entirely.
 */
export function treeLabelBudget(shared: TreeRowShared, reserved: number): number {
  const width = shared.width ?? SIDEBAR_WIDTH
  // marker (1) + indent (1) + paddingRight (1) = 3 cells every row spends.
  return Math.max(6, width - 3 - reserved)
}

/** Cells one right-cluster glyph occupies: itself plus the row's 1-cell gap. */
export function clusterCells(text: string): number {
  let cells = 1
  for (const ch of text) cells += charWidth(ch.codePointAt(0) ?? 0)
  return cells
}

/** Budget the row's own jump digit costs — it is the last cluster item, and
 *  a label that ate its cells would push the number off the rail. */
export function jumpDigitCells(flatIndex: number): number {
  const digit = taskJumpDigit(flatIndex)
  return digit === null ? 0 : clusterCells(digit)
}

/** The move-mode chip a dragged ROW wears — same vocabulary as
 *  the project header's chip, so all three levels read identically. */
export function MoveChip(props: { readonly rowId: string; readonly shared: TreeRowShared }) {
  const { theme } = useTheme()
  const t = useT()
  if (props.shared.movingRowId !== props.rowId) return null
  return (
    <text fg={theme.info} wrapMode="none" flexShrink={0}>
      {t("tasks.moveChip").trim()}
    </text>
  )
}

export function RowShell(props: {
  readonly rowId: string
  readonly flatIndex: number
  readonly depth: number
  readonly shared: TreeRowShared
  readonly children: ReactNode
}) {
  const { theme } = useTheme()
  const shared = props.shared
  const selection = resolveRowSelectionChrome(theme, {
    cursor: shared.cursorIndex === props.flatIndex,
    selected: shared.activeRowId === props.rowId,
  })
  return (
    <box
      ref={(renderable: BoxRenderable | null) => {
        if (!renderable) return
        shared.rowEls.set(props.flatIndex, renderable)
        return () => {
          if (shared.rowEls.get(props.flatIndex) === renderable) shared.rowEls.delete(props.flatIndex)
        }
      }}
      width="100%"
      flexDirection="row"
      gap={0}
      backgroundColor={selection.backgroundColor}
      onMouseUp={(evt: { button: number; x: number; y: number; stopPropagation(): void }) => {
        // Don't bubble to the pane box's focus-grab (the workspace host's
        // sidebar shell): activating a row hands focus to the CONTENT pane,
        // a bubbled sidebar re-grab would overwrite it, leaving the sidebar's
        // letter chords (d!) live over what looks like the terminal. Same
        // guard the ZEN chip carries.
        evt.stopPropagation()
        // Right-click opens the row's menu instead of activating it — the
        // terminal only forwards button 2 while mouse reporting is on, which
        // is the same mode the left-click activate already depends on.
        if (evt.button === MouseButton.RIGHT && shared.onContextMenu) {
          shared.onContextMenu(props.flatIndex, props.rowId, evt.x, evt.y)
          return
        }
        shared.onPress(props.flatIndex, props.rowId)
      }}
    >
      <text fg={selection.markerColor} wrapMode="none">
        {selection.marker}
      </text>
      <text wrapMode="none" flexShrink={0}>
        {" ".repeat(props.depth * INDENT_CELLS)}
      </text>
      {props.children}
    </box>
  )
}
