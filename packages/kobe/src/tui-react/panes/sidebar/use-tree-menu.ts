/**
 * The tree sidebar's right-click menu state. What it OFFERS is `tree-menu.ts`;
 * what entries DO is the host's callbacks; this holds the React state, the
 * `t()` pass, and the dispatch between them.
 */

import { useCallback, useState } from "react"
import { formatChord } from "../../../tui/lib/chord-glyphs"
import { legendCap } from "../../../tui/lib/help-groups"
import type { TreeRow } from "../../../tui/panes/sidebar/tree-core"
import { type TreeMenuAction, type TreeMenuContext, treeMenuItems } from "../../../tui/panes/sidebar/tree-menu"
import { useT } from "../../i18n"
import { useGlobalMouseDown } from "../../lib/use-global-mouse-down"
import type { ContextMenuEntry } from "../../ui/context-menu"
import type { SidebarTaskCallbacks } from "./types"
import type { TreeState } from "./use-tree-state"

export interface TreeMenu {
  readonly open: boolean
  readonly entries: readonly ContextMenuEntry[]
  readonly cursor: number
  readonly x: number
  readonly y: number
  readonly close: () => void
  readonly moveCursor: (delta: 1 | -1) => void
  /** Fire the highlighted entry (enter). */
  readonly pickCurrent: () => void
  /** Fire an entry by action id (a click on a menu row). */
  readonly pick: (action: string) => void
  /** Right-click landed on a worktree or tab row. */
  readonly openForRow: (flatIndex: number, rowId: string, x: number, y: number) => void
  /** Right-click landed on a project header. */
  readonly openForProject: (projectId: string, x: number, y: number) => void
}

export interface TreeMenuDeps {
  readonly tree: TreeState
  readonly activateRow: (rowId: string) => void
  readonly setCursorIndex: (index: number) => void
  readonly onAddTask?: () => void
  /** Close one tab; the host owns the mounted/background split. */
  readonly onCloseTab?: (taskId: string, tabId: string) => void
  /** `"chat"` opens the ctrl+e picker there, `"shell"` a bare shell tab. */
  readonly onNewTab?: (taskId: string, kind: "chat" | "shell") => void
  readonly actions: SidebarTaskCallbacks
}

/** The chord an entry advertises, or `undefined` for a menu-only verb. */
function menuCap(bindingId: string | undefined): string | undefined {
  if (!bindingId) return undefined
  const cap = legendCap(bindingId)
  return cap ? formatChord(cap) : undefined
}

interface OpenMenu {
  readonly row: TreeRow
  readonly actions: readonly TreeMenuAction[]
  readonly entries: readonly ContextMenuEntry[]
  readonly x: number
  readonly y: number
}

export function useTreeMenu(deps: TreeMenuDeps): TreeMenu {
  const t = useT()
  const { tree, activateRow, setCursorIndex, actions } = deps
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const [cursor, setCursor] = useState(0)

  const openAt = useCallback(
    (row: TreeRow, ctx: TreeMenuContext, x: number, y: number): void => {
      const items = treeMenuItems(row, ctx)
      setMenu({
        row,
        actions: items.map((item) => item.action),
        // Caps resolve at OPEN time from the live keymap; unbound ids get none.
        entries: items.map((item) => ({
          id: item.action,
          label: t(item.labelKey),
          danger: item.danger,
          cap: menuCap(item.bindingId),
        })),
        x,
        y,
      })
      setCursor(0)
    },
    [t],
  )

  const openForRow = useCallback(
    (flatIndex: number, rowId: string, x: number, y: number): void => {
      const row = tree.rows.find((candidate) => candidate.id === rowId)
      // Shortcut rows ("↩ recent", routine count) name no task: no menu.
      if (!row || row.kind === "project" || row.kind === "machine" || row.kind === "recent" || row.kind === "routines")
        return
      // Menu and highlight must agree on the target row.
      setCursorIndex(flatIndex)
      openAt(row, { tabCount: tree.tabCount(row.task.id) }, x, y)
    },
    [tree.rows, tree.tabCount, openAt, setCursorIndex],
  )

  const openForProject = useCallback(
    (projectId: string, x: number, y: number): void => {
      const row = tree.rows.find((candidate) => candidate.kind === "project" && candidate.id === projectId)
      if (!row) return
      // Only THIS daemon's mains are in the move partition; another machine's
      // project is read-only here.
      const movable = (candidate: TreeRow): boolean =>
        candidate.kind === "project" &&
        candidate.machineId === "local" &&
        tree.mainTaskIdOfProject(candidate.id) !== null
      const mainId = movable(row) ? tree.mainTaskIdOfProject(projectId) : null
      // The header has no cursor slot; its main row stands in, so "Reorder
      // project" starts move mode where j/k drag the project.
      const mainIndex = mainId === null ? -1 : tree.flatIds.indexOf(mainId)
      if (mainIndex >= 0) setCursorIndex(mainIndex)
      const firstMovable = tree.rows.find(movable)
      openAt(row, { projectMovable: mainIndex >= 0, projectFirst: firstMovable?.id === projectId }, x, y)
    },
    [tree.rows, tree.flatIds, tree.mainTaskIdOfProject, openAt, setCursorIndex],
  )

  const close = useCallback((): void => setMenu(null), [])

  // A press elsewhere dismisses. Presses INSIDE never reach the root
  // (`ContextMenu` stops the down phase), so picking still gets its mouse-up.
  useGlobalMouseDown(menu !== null, close)

  const moveCursor = useCallback(
    (delta: 1 | -1): void => {
      const count = menu?.entries.length ?? 0
      if (count === 0) return
      // Wraps.
      setCursor((prev) => (prev + delta + count) % count)
    },
    [menu],
  )

  /** Run an entry. The menu adds a route, not a capability (see `tree-menu.ts`). */
  const fire = useCallback(
    (action: TreeMenuAction | undefined): void => {
      if (!menu || action === undefined) return
      // Close BEFORE dispatching: several actions open a dialog.
      const row = menu.row
      setMenu(null)
      if (row.kind === "project") {
        if (action === "newTask") deps.onAddTask?.()
        if (action === "fieldNotes") actions.onFieldNotesRequest?.(row.repo)
        const mainId = deps.tree.mainTaskIdOfProject(row.id)
        if (!mainId) return
        // Same flow as `d` on the project's main checkout row.
        if (action === "forgetProject") actions.onDeleteRequest?.(mainId)
        if (action === "moveToTop") actions.onMoveToTopRequest?.(mainId)
        // Already moving: the cursor is on this main now, so j/k drag it — a
        // toggle would leave move mode instead.
        if (action === "reorder" && !actions.moveMode) actions.onLocalMergeRequest?.(mainId)
        return
      }
      // Only reachable through a stale `menu`.
      if (row.kind === "routines" || row.kind === "machine") return
      const taskId = row.task.id
      switch (action) {
        case "open":
          activateRow(row.id)
          break
        case "closeTab":
          if (row.kind === "tab") deps.onCloseTab?.(taskId, row.tab.id)
          break
        case "newChat":
          deps.onNewTab?.(taskId, "chat")
          break
        case "newShell":
          deps.onNewTab?.(taskId, "shell")
          break
        case "rename":
          actions.onRenameRequest?.(taskId)
          break
        case "pin":
          actions.onPinRequest?.(taskId)
          break
        case "reorder":
          // Same as the project's: opening the menu put the cursor on this row.
          if (!actions.moveMode) actions.onLocalMergeRequest?.(taskId)
          break
        case "runAgain":
          actions.onRunAgainRequest?.(taskId)
          break
        case "setStatus":
          actions.onSetStatusRequest?.(taskId)
          break
        case "copyBranch":
          actions.onCopyRequest?.(taskId, "branch")
          break
        case "copyPath":
          actions.onCopyRequest?.(taskId, "path")
          break
        // The `o` / `b` / `v` trio: the MENU's row, not the active task the chords read.
        case "openEditor":
          actions.onOpenEditorRequest?.(taskId)
          break
        case "renameBranch":
          actions.onRenameBranchRequest?.(taskId)
          break
        case "changeEngine":
          actions.onChangeEngineRequest?.(taskId)
          break
        case "fixChecks":
          actions.onFixChecksRequest?.(taskId)
          break
        case "syncBase":
          actions.onSyncBaseRequest?.(taskId)
          break
        case "land":
          actions.onLandRequest?.(taskId)
          break
        case "delete":
          actions.onDeleteRequest?.(taskId)
          break
        default:
          break
      }
    },
    [menu, activateRow, actions, deps.onAddTask, deps.onCloseTab, deps.onNewTab, deps.tree.mainTaskIdOfProject],
  )

  const pickCurrent = useCallback((): void => fire(menu?.actions[cursor]), [fire, menu, cursor])
  const pick = useCallback(
    (action: string): void => fire(menu?.actions.find((candidate) => candidate === action)),
    [fire, menu],
  )

  return {
    open: menu !== null,
    entries: menu?.entries ?? [],
    cursor,
    x: menu?.x ?? 0,
    y: menu?.y ?? 0,
    close,
    moveCursor,
    pickCurrent,
    pick,
    openForRow,
    openForProject,
  }
}
