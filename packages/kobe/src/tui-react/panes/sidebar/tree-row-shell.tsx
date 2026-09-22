/** @jsxImportSource @opentui/react */
/**
 * The chrome every tree row sits in (`RowShell`: marker, indent, mouse
 * contract) and the cell arithmetic each row budgets its label against.
 */

import type { RowTokenMap, TaskEngineState, TaskJobState } from "@/client/remote-orchestrator"
import { type BoxRenderable, MouseButton } from "@opentui/core"
import type { ReactNode } from "react"
import { charWidth } from "../../../lib/display-width"
import { SIDEBAR_WIDTH } from "../../../tui/panes/sidebar/view-core"
import type { WorktreeChanges } from "../../../tui/panes/sidebar/worktree-changes"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import { resolveRowSelectionChrome } from "../../ui/row-selection-chrome"

/** One cell per depth level: the rail is narrow and the glyph column already separates levels. */
const INDENT_CELLS = 1

export type TreeRowShared = {
  /** Rail width in cells; the label budget derives from it. */
  readonly width?: number
  /** Cursor position in the tree's flat id list. */
  readonly cursorIndex: number
  /** The row id the right pane is showing (`taskId::tabId` when a tab). */
  readonly activeRowId: string | null
  /** The unread-lamp digest keys on THIS, not `activeRowId`: that id needs
   *  the live tab map, which is cold right after a restart. */
  readonly selectedTaskId: string | null
  /** Row wearing the move chip. Null outside move mode, and while a `main`
   *  row drags its project (the header wears it then). */
  readonly movingRowId?: string | null
  /** Keyed by FLAT INDEX so one scroll-follow lookup covers every row. */
  readonly rowEls: Map<number, BoxRenderable>
  readonly onPress: (flatIndex: number, rowId: string) => void
  /** Right-click. Absent = right-click falls through to a plain activate. */
  readonly onContextMenu?: (flatIndex: number, rowId: string, x: number, y: number) => void
  /** The sidebar's ~2s poll tick — drives the ±stats poller. */
  readonly branchTick: number
  /** The row's jump digit, or null. Resolved once per tree build. */
  readonly jumpDigitOf: (rowId: string) => string | null
  /** Per-tab activity (taskId → tabId → state), never the task rollup. */
  readonly engineTabState?: ReadonlyMap<string, ReadonlyMap<string, TaskEngineState>>
  readonly engineLifecycle?: ReadonlyMap<string, { readonly subagents: number }>
  readonly taskJobs?: ReadonlyMap<string, TaskJobState>
  readonly rowTokens?: RowTokenMap
  readonly worktreeChanges?: ReadonlyMap<string, WorktreeChanges | null> | null
}

/**
 * Cell budget for a row's label, so a clip ends in a visible `…` rather than
 * Yoga's bare cut (a chopped branch reads as the full name). `reserved` is
 * the LIVE right-cluster width. Slight over-budget is safe (flex still
 * clips); the floor keeps a crowded row's label from vanishing.
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

/** Cells the row's jump digit costs, or 0 with no digit (tab rows: digits count TASKS). */
export function jumpDigitCells(digit: string | null): number {
  return digit === null ? 0 : clusterCells(digit)
}

/** The move chip a dragged ROW wears; same vocabulary as the project header's. */
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
        // Activating hands focus to the content pane; a bubbled sidebar
        // re-grab would leave sidebar letter chords live over the terminal.
        evt.stopPropagation()
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
