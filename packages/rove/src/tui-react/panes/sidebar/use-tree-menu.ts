/**
 * The tree sidebar's right-click menu state. What it OFFERS is `tree-menu.ts`;
 * what entries DO is the host's callbacks; this holds the React state, the
 * `t()` pass, and the dispatch between them.
 */

import { useCallback, useMemo, useState } from "react"
import { resolvePreferredVendor } from "../../../state/vendor-prefs"
import { formatChord } from "../../../tui/lib/chord-glyphs"
import { legendCap } from "../../../tui/lib/help-groups"
import { pausedGitOperation } from "../../../tui/ops/conflict-prompt"
import { SCRATCH_SECTION_ID, type TreeRow } from "../../../tui/panes/sidebar/tree-core"
import {
  TREE_MENU_SECTIONS,
  type TreeMenuAction,
  type TreeMenuContext,
  type TreeMenuSection,
  treeMenuItems,
  treeMenuSection,
} from "../../../tui/panes/sidebar/tree-menu"
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
  /** Put the highlight on an entry (the pointer is over it). */
  readonly setCursor: (index: number) => void
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
  /** `"chat"` opens the ctrl+e picker there, `"shell"` a bare shell tab, `"continue"` the picker preset to carry the conversation over. */
  readonly onNewTab?: (taskId: string, kind: "chat" | "shell" | "continue") => void
  readonly actions: SidebarTaskCallbacks
}

/** The chord an entry advertises, or `undefined` for a menu-only verb. */
function menuCap(bindingId: string | undefined): string | undefined {
  if (!bindingId) return undefined
  const cap = legendCap(bindingId)
  return cap ? formatChord(cap) : undefined
}

/** The two entries that open a list one level down, as the web's `Copy ›` and `More ›` do. */
type Submenu = "copy" | "more"
const SUBMENU_ID = (sub: Submenu): string => `submenu:${sub}`
const BACK_ID = "submenu:back"

interface OpenMenu {
  readonly row: TreeRow
  /** Every entry the row offers, each with its section. */
  readonly entries: readonly (ContextMenuEntry & { readonly section: TreeMenuSection })[]
  /** The list showing in place of the top level, when one is open. */
  readonly sub: Submenu | null
  readonly x: number
  readonly y: number
}

/** What the menu shows: the top level with `Copy ›` and `More ›` standing in for their entries, or one of those lists. */
function visibleEntries(menu: OpenMenu, t: (key: string) => string): readonly ContextMenuEntry[] {
  if (menu.sub) {
    const back: ContextMenuEntry = { id: BACK_ID, label: `‹ ${t("tasks.menu.back")}`, section: "back" }
    return [
      back,
      ...menu.entries.filter((entry) => entry.section === menu.sub).map((entry) => ({ ...entry, section: "list" })),
    ]
  }
  return TREE_MENU_SECTIONS.flatMap((section): ContextMenuEntry[] => {
    const inSection = menu.entries.filter((entry) => entry.section === section)
    if (inSection.length === 0) return []
    if (section === "copy" || section === "more")
      // The chevron sits where a key hint would, at the row's end, as the web's does.
      return [{ id: SUBMENU_ID(section), label: t(`tasks.menu.${section}`), cap: "›", section }]
    return [...inSection]
  })
}

/** This daemon's projects, in sidebar order: another machine's is read-only here, and Ungrouped is no project. */
function movableProjects(rows: readonly TreeRow[]): TreeRow[] {
  return rows.filter((row) => row.kind === "project" && row.machineId === "local" && row.id !== SCRATCH_SECTION_ID)
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
        sub: null,
        // Caps resolve at OPEN time from the live keymap; unbound ids get none.
        entries: items.map((item) => ({
          id: item.action,
          label: t(item.labelKey),
          danger: item.danger,
          section: treeMenuSection(item.action),
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
      // The "↩ recent" shortcut row names no task: no menu.
      if (!row || row.kind === "project" || row.kind === "recent") return
      // Menu and highlight must agree on the target row.
      setCursorIndex(flatIndex)
      // Another machine's worktree path means nothing on this filesystem.
      const local = (row.task.origin?.machineId ?? "local") === "local"
      const operationPaused = local && pausedGitOperation(row.task.worktreePath) !== null
      const notificationsMuted = actions.isNotificationsMuted?.(row.task.id) === true
      openAt(row, { operationPaused, notificationsMuted }, x, y)
    },
    [tree.rows, openAt, setCursorIndex, actions.isNotificationsMuted],
  )

  const openForProject = useCallback(
    (projectId: string, x: number, y: number): void => {
      const row = tree.rows.find((candidate) => candidate.kind === "project" && candidate.id === projectId)
      if (!row) return
      if (projectId === SCRATCH_SECTION_ID) {
        openAt(row, { scratchSection: true }, x, y)
        return
      }
      const movable = movableProjects(tree.rows)
      const at = movable.findIndex((candidate) => candidate.id === projectId)
      // A search hides projects, so "up" and "down" would name a neighbour that is not the real one.
      const projectMovable = at >= 0 && !tree.searching
      openAt(row, { projectMovable, projectFirst: at === 0, projectLast: at === movable.length - 1 }, x, y)
    },
    [tree.rows, tree.searching, openAt],
  )

  const close = useCallback((): void => setMenu(null), [])

  // A press elsewhere dismisses. Presses INSIDE never reach the root
  // (`ContextMenu` stops the down phase), so picking still gets its mouse-up.
  useGlobalMouseDown(menu !== null, close)

  const visible = useMemo(() => (menu ? visibleEntries(menu, t) : []), [menu, t])

  const moveCursor = useCallback(
    (delta: 1 | -1): void => {
      const count = visible.length
      if (count === 0) return
      // Wraps.
      setCursor((prev) => (prev + delta + count) % count)
    },
    [visible],
  )

  /** Run an entry. The menu adds a route, not a capability (see `tree-menu.ts`). */
  const fire = useCallback(
    (action: TreeMenuAction | undefined): void => {
      if (!menu || action === undefined) return
      // Close BEFORE dispatching: several actions open a dialog.
      const row = menu.row
      setMenu(null)
      if (row.kind === "project") {
        // The Scratch section: a Scratch task in $HOME, on the preferred engine or a bare shell.
        if (action === "newScratchChat") actions.onOpenScratch?.(resolvePreferredVendor())
        if (action === "newScratchShell") actions.onOpenScratch?.(undefined)
        if (action === "newTask") deps.onAddTask?.()
        if (action === "fieldNotes") actions.onFieldNotesRequest?.(row.repo)
        if (action === "forgetProject") actions.onForgetProjectRequest?.(row.repo)
        const movable = movableProjects(deps.tree.rows)
        const at = movable.findIndex((candidate) => candidate.id === row.id)
        const beside = (target: TreeRow | undefined, side: "before" | "after"): void => {
          if (target?.kind === "project") actions.onMoveProjectRequest?.(row.repo, target.repo, side)
        }
        if (action === "moveToTop") beside(movable[0], "before")
        if (action === "moveProjectUp") beside(movable[at - 1], "before")
        if (action === "moveProjectDown") beside(movable[at + 1], "after")
        return
      }
      const taskId = row.task.id
      switch (action) {
        case "open":
          activateRow(row.id)
          break
        case "toggleFold":
          tree.toggleTaskFold(taskId)
          break
        case "newChat":
          deps.onNewTab?.(taskId, "chat")
          break
        case "newShell":
          deps.onNewTab?.(taskId, "shell")
          break
        case "continueEngine":
          deps.onNewTab?.(taskId, "continue")
          break
        case "newTaskFromBranch":
          actions.onNewTaskFromBranchRequest?.(taskId)
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
        case "muteNotifications":
          actions.onToggleMuteRequest?.(taskId)
          break
        case "moveToProject":
          actions.onMoveToProjectRequest?.(taskId)
          break
        case "copyId":
          actions.onCopyRequest?.(taskId, "id")
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
        case "rerunChecks":
          actions.onRerunChecksRequest?.(taskId)
          break
        case "syncBase":
          actions.onSyncBaseRequest?.(taskId)
          break
        case "resolveConflicts":
          actions.onResolveConflictsRequest?.(taskId)
          break
        case "land":
          actions.onLandRequest?.(taskId)
          break
        case "archive":
          actions.onArchiveRequest?.(taskId)
          break
        case "delete":
          actions.onDeleteRequest?.(taskId)
          break
        default:
          break
      }
    },
    [menu, activateRow, actions, deps.onAddTask, deps.onNewTab, deps.tree.rows, tree.toggleTaskFold],
  )

  const pick = useCallback(
    (id: string): void => {
      if (!menu) return
      // A list entry swaps what the menu shows; it runs nothing.
      const sub = (["copy", "more"] as const).find((candidate) => SUBMENU_ID(candidate) === id)
      if (sub || id === BACK_ID) {
        setMenu({ ...menu, sub: sub ?? null })
        setCursor(0)
        return
      }
      fire(menu.entries.find((entry) => entry.id === id)?.id as TreeMenuAction | undefined)
    },
    [fire, menu],
  )
  const pickCurrent = useCallback((): void => {
    const id = visible[cursor]?.id
    if (id !== undefined) pick(id)
  }, [pick, visible, cursor])

  return {
    open: menu !== null,
    entries: visible,
    cursor,
    setCursor,
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
