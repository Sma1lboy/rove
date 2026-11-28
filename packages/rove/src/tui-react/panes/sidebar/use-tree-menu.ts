/**
 * The tree sidebar's right-click menu state. What it OFFERS is `tree-menu.ts`;
 * what entries DO is the host's callbacks; this holds the React state, the
 * `t()` pass, and the dispatch between them.
 */

import { formatChord } from "@sma1lboy/rove-client/keys/chord-glyphs.ts"
import { legendCap } from "@sma1lboy/rove-client/keys/help-groups.ts"
import { resolvePreferredVendor } from "@sma1lboy/rove-core/state/vendor-prefs.ts"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
import type { ContextMenuEntry, ContextSubmenu } from "../../ui/context-menu"
import type { SidebarTaskCallbacks } from "./types"
import type { TreeState } from "./use-tree-state"

export interface TreeMenu {
  readonly open: boolean
  readonly entries: readonly ContextMenuEntry[]
  /** -1 until the pointer or a key picks an entry, as the web's pointer-opened menu. */
  readonly cursor: number
  /** The list open beside the menu (`Copy`, `More`), or null. */
  readonly sub: ContextSubmenu | null
  readonly x: number
  readonly y: number
  readonly close: () => void
  /** Escape: out of an open list first, then the menu. */
  readonly back: () => void
  readonly moveCursor: (delta: 1 | -1) => void
  /** The pointer is over an entry: it lights up, and one with a list opens it after a beat. */
  readonly hover: (index: number) => void
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
  readonly onAddTask?: (repo?: string) => void
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

/** The two entries that open a list beside the menu, as the web's `Copy ›` and `More ›` do. */
type Submenu = "copy" | "more"
const SUBMENUS: readonly Submenu[] = ["copy", "more"]
const SUBMENU_ID = (sub: Submenu): string => `submenu:${sub}`
/** How long the pointer rests on such an entry before its list opens (the web's `SUB_OPEN_MS`). */
const SUB_OPEN_MS = 120

type MenuEntry = ContextMenuEntry & { readonly section: TreeMenuSection }

interface OpenMenu {
  readonly row: TreeRow
  /** Every entry the row offers, each with its section. */
  readonly entries: readonly MenuEntry[]
  readonly x: number
  readonly y: number
}

/** The top level: each section's entries, with `Copy` and `More` standing in for theirs. */
function topEntries(menu: OpenMenu, t: (key: string) => string): readonly ContextMenuEntry[] {
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
  const [cursor, setCursor] = useState(-1)
  // The list open beside the menu, the highlight in it, and whether the keys drive it.
  const [sub, setSub] = useState<Submenu | null>(null)
  const [subCursor, setSubCursor] = useState(-1)
  const [inSub, setInSub] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const openAt = useCallback(
    (row: TreeRow, ctx: TreeMenuContext, x: number, y: number): void => {
      const items = treeMenuItems(row, ctx)
      setMenu({
        row,
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
      setCursor(-1)
      setSub(null)
      setInSub(false)
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

  const close = useCallback((): void => {
    clearTimeout(timer.current)
    setMenu(null)
  }, [])

  // A press elsewhere dismisses. Presses INSIDE never reach the root
  // (`ContextMenu` stops the down phase), so picking still gets its mouse-up.
  useGlobalMouseDown(menu !== null, close)

  const visible = useMemo(() => (menu ? topEntries(menu, t) : []), [menu, t])
  const subEntries = useMemo(
    () => (menu && sub ? menu.entries.filter((entry) => entry.section === sub) : []),
    [menu, sub],
  )

  const openSub = useCallback((next: Submenu, byKeys: boolean): void => {
    clearTimeout(timer.current)
    setSub(next)
    setInSub(byKeys)
    setSubCursor(byKeys ? 0 : -1)
  }, [])
  const closeSub = useCallback((): void => {
    clearTimeout(timer.current)
    setSub(null)
    setInSub(false)
  }, [])

  const back = useCallback((): void => (inSub ? closeSub() : close()), [inSub, closeSub, close])

  const moveCursor = useCallback(
    (delta: 1 | -1): void => {
      const count = inSub ? subEntries.length : visible.length
      if (count === 0) return
      // Wraps; from "nothing lit" the first step lands on an end.
      const step = (prev: number): number => (prev < 0 ? (delta === 1 ? 0 : count - 1) : (prev + delta + count) % count)
      if (inSub) setSubCursor(step)
      else {
        closeSub()
        setCursor(step)
      }
    },
    [inSub, subEntries, visible, closeSub],
  )

  const hover = useCallback(
    (index: number): void => {
      setCursor(index)
      setInSub(false)
      clearTimeout(timer.current)
      const next = SUBMENUS.find((candidate) => SUBMENU_ID(candidate) === visible[index]?.id)
      if (next) timer.current = setTimeout(() => openSub(next, false), SUB_OPEN_MS)
      else closeSub()
    },
    [visible, openSub, closeSub],
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
        if (action === "newTask") deps.onAddTask?.(row.repo)
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
        case "abortOperation":
          actions.onAbortOperationRequest?.(taskId)
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
      // An entry with a list opens it; it runs nothing itself.
      const next = SUBMENUS.find((candidate) => SUBMENU_ID(candidate) === id)
      if (next) {
        openSub(next, false)
        return
      }
      fire(menu.entries.find((entry) => entry.id === id)?.id as TreeMenuAction | undefined)
    },
    [fire, menu, openSub],
  )
  const pickCurrent = useCallback((): void => {
    if (inSub) {
      const id = subEntries[subCursor]?.id
      if (id !== undefined) pick(id)
      return
    }
    // Nothing lit yet: Enter is swallowed rather than reaching the row under the menu.
    const id = visible[cursor]?.id
    const next = SUBMENUS.find((candidate) => SUBMENU_ID(candidate) === id)
    if (next) openSub(next, true)
    else if (id !== undefined) pick(id)
  }, [pick, openSub, inSub, subEntries, subCursor, visible, cursor])

  const subAnchor = sub ? visible.findIndex((entry) => entry.id === SUBMENU_ID(sub)) : -1
  const subView: ContextSubmenu | null =
    sub && subAnchor >= 0
      ? {
          anchor: subAnchor,
          // One list, no sections of its own.
          entries: subEntries.map((entry) => ({ ...entry, section: undefined })),
          cursor: subCursor,
          onPick: pick,
          onHover: (index) => {
            clearTimeout(timer.current)
            setSubCursor(index)
            setInSub(true)
          },
        }
      : null

  return {
    open: menu !== null,
    entries: visible,
    cursor,
    sub: subView,
    hover,
    back,
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
