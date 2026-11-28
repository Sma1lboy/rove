/** @jsxImportSource @opentui/react */
/**
 * The chrome every tree row sits in (`RowShell`: marker, indent, mouse
 * contract) and the cell arithmetic each row budgets its label against.
 */

import type { RowTokenMap, TaskEngineState, TaskJobState } from "@/client/remote-orchestrator"
import { type BoxRenderable, MouseButton } from "@opentui/core"
import { charWidth } from "@sma1lboy/rove-core/lib/display-width.ts"
import type { TreeGuide } from "@sma1lboy/rove-core/lib/tree-guides.ts"
import type { ReactNode } from "react"
import { SIDEBAR_WIDTH } from "../../../tui/panes/sidebar/view-core"
import type { WorktreeChanges } from "../../../worktree/worktree-changes"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import { resolveRowSelectionChrome } from "../../ui/row-selection-chrome"
import { useHoverFill } from "../../ui/use-hover-fill"

/** Two cells per indent column, as the web draws them: a line passing by or on to the next sibling, a hook into the last child. */
const GUIDE_CELLS: Readonly<Record<TreeGuide, string>> = { pipe: "│ ", blank: "  ", tee: "│ ", elbow: "╰ " }

export type TreeRowShared = {
  /** Rail width in cells; the label budget derives from it. */
  readonly width?: number
  /** Cursor position in the tree's flat id list. */
  readonly cursorIndex: number
  /** The row id the right pane is showing: its task's. */
  readonly activeRowId: string | null
  /** The unread-lamp digest keys on THIS, not `activeRowId`: that id needs
   *  the live tab map, which is cold right after a restart. */
  readonly selectedTaskId: string | null
  /** Row wearing the move chip. Null outside move mode. */
  readonly movingRowId?: string | null
  /** Keyed by FLAT INDEX so one scroll-follow lookup covers every row. */
  readonly rowEls: Map<number, BoxRenderable>
  readonly onPress: (flatIndex: number, rowId: string) => void
  /** Right-click. Absent = right-click falls through to a plain activate. */
  readonly onContextMenu?: (flatIndex: number, rowId: string, x: number, y: number) => void
  /** Fold or unfold a task's children (a click on its fold glyph). */
  readonly onToggleFold?: (taskId: string) => void
  /** Bumps when a git poll lands a changed value; rows re-render to read it. */
  readonly branchTick: number
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
  // marker (1) + paddingRight (1) = 2 cells every row spends.
  return Math.max(6, width - 2 - reserved)
}

/** Cells one right-cluster glyph occupies: itself plus the row's 1-cell gap. */
export function clusterCells(text: string): number {
  let cells = 1
  for (const ch of text) cells += charWidth(ch.codePointAt(0) ?? 0)
  return cells
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
  /** The row's indent columns (`treeGuides`); none for a top-level row. */
  readonly guides?: readonly TreeGuide[]
  readonly shared: TreeRowShared
  readonly children: ReactNode
}) {
  const { theme } = useTheme()
  const shared = props.shared
  const selection = resolveRowSelectionChrome(theme, {
    cursor: shared.cursorIndex === props.flatIndex,
    selected: shared.activeRowId === props.rowId,
  })
  const hover = useHoverFill()
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
      backgroundColor={selection.backgroundColor ?? hover.fill}
      {...hover.handlers}
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
      {/* A hovered row that is neither the cursor nor the open one borrows the marker, quietly. */}
      <text fg={selection.markerColor ?? theme.border} wrapMode="none">
        {selection.marker === " " && hover.hovered ? "▏" : selection.marker}
      </text>
      {props.guides?.length ? (
        <text fg={theme.border} wrapMode="none" flexShrink={0}>
          {props.guides.map((guide) => GUIDE_CELLS[guide]).join("")}
        </text>
      ) : null}
      {props.children}
    </box>
  )
}
