/** @jsxImportSource @opentui/react */
/**
 * The tree sidebar: project → Task → Terminal Tab. Everything starts
 * expanded; the collapse sets hold only what you folded by hand. The cursor
 * indexes one flat id list, so a tab row is selected exactly like a task.
 */

import type { Task } from "@/types/task"
import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core"
import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useMachineRows } from "../../../machines/hub-singleton"
import { createSidebarController } from "../../../tui/panes/sidebar/controller"
import { RECENT_ROW_ID, parseRowId } from "../../../tui/panes/sidebar/tree-core"
import { MAIN_BRANCH_POLL_MS, SIDEBAR_WIDTH } from "../../../tui/panes/sidebar/view-core"
import { usePaneHintMark } from "../../component/keyboard-hints"
import { useOptionalKV } from "../../context/kv"
import { useTheme } from "../../context/theme"
import { useLatest } from "../../lib/use-latest"
import { useTerminalDimensions } from "../../lib/use-terminal-dimensions"
import { ContextMenu } from "../../ui/context-menu"
import { SidebarBrandHeader, SidebarCreateAction, SidebarNavRail, SidebarSearchInput, SidebarZenChip } from "./chrome"
import { CollapseButton } from "./collapse-button"
import { SidebarTreeBody } from "./tree-panel"
import type { TreeRowShared } from "./tree-row-shell"
import type { SidebarProps } from "./types"
import { cursorTaskIdOf, useTreeBindings } from "./use-tree-bindings"
import { useTreeMenu } from "./use-tree-menu"
import { useTreeSearch } from "./use-tree-search"
import { useTreeState } from "./use-tree-state"

export type SidebarTreeProps = SidebarProps & {
  /** The selected task's active tab, so the tree can mark the live row. */
  selectedTabId?: string | null
  /** Activate a specific tab of a task. */
  onSelectTab?: (taskId: string, tabId: string) => void
  /** Close one tab of any worktree — offered by the tab row's menu. */
  onCloseTab?: (taskId: string, tabId: string) => void
  /** Open a new conversation ("chat" — the ctrl+e picker) or a bare shell tab
   *  in any worktree — offered by the worktree/tab rows' menu. */
  onNewTab?: (taskId: string, kind: "chat" | "shell") => void
  /** Move one tab within its task (move mode on a tab row). */
  onMoveTabRequest?: (taskId: string, tabId: string, delta: -1 | 1) => void
  /** Narrow mode's "↩ recent" row: first navigable row; ⏎ re-enters that task. */
  recentTask?: Task | null
  /** Filled with a reader of the task under the cursor, so the host's
   *  sidebar-scope chords (`b`/`v`/`o`) can target the highlighted row. */
  cursorTaskIdRef?: MutableRefObject<() => string | null>
  /** Fold the rail away. Absent = the rail renders without the control. */
  onToggleCollapsed?: () => void
}

export function SidebarTree(props: SidebarTreeProps) {
  const { theme } = useTheme()
  // Optional: kv only adds tasks not mounted since restart; without it the tree is restart-blind.
  const kv = useOptionalKV()
  const focused = props.focused ?? true
  const dims = useTerminalDimensions()

  // The ~2s branch/changes poll tick the row cards' effects key on.
  const [branchTick, setBranchTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setBranchTick((n) => n + 1), MAIN_BRANCH_POLL_MS)
    return () => clearInterval(timer)
  }, [])

  const machines = useMachineRows()
  const search = useTreeSearch({ focused, onActiveChange: props.onSearchActiveChange })
  const tree = useTreeState({
    tasks: props.tasks,
    kv,
    selectedTaskId: props.selectedId,
    selectedTabId: props.selectedTabId ?? null,
    query: search.active ? search.query : "",
    recentTask: props.recentTask ?? null,
    sortMode: props.sortMode,
    engineState: props.engineState,
    branchTick,
    machines,
  })
  const flatIndexOf = useMemo(() => {
    const map = new Map<string, number>()
    tree.flatIds.forEach((id, i) => map.set(id, i))
    return map
  }, [tree.flatIds])

  // Cursor: state + ref written together so key handlers between renders read
  // the just-set index (React commits state later).
  const [cursorIndex, setCursorIndexState] = useState(-1)
  const cursorRef = useRef(cursorIndex)
  const setCursorIndex = useCallback((next: number): void => {
    cursorRef.current = next
    setCursorIndexState(next)
  }, [])
  const flatIdsRef = useLatest(tree.flatIds)
  // A reader, not a value: a chord in the same tick as the `j` sees the new row.
  const cursorTaskIdRef = props.cursorTaskIdRef
  useEffect(() => {
    if (!cursorTaskIdRef) return
    cursorTaskIdRef.current = () => cursorTaskIdOf(flatIdsRef.current[cursorRef.current])
  }, [cursorTaskIdRef])

  // Follow the active row when selection moves from elsewhere (F7, inbox).
  // EDGE-triggered on the active row CHANGING: flatIds rebuilds every 2s tick
  // and engine push, and re-anchoring then would yank a j/k-walking cursor.
  // Clamps run on every list change so a shrunken list can't strand it.
  const prevActiveRef = useRef<string | null>(null)
  // The row under the cursor LAST render; move mode re-anchors to it.
  const cursorRowIdRef = useRef<string | null>(null)
  const moveMode = props.moveMode === true
  useEffect(() => {
    const ids = tree.flatIds
    // Move mode: follow the ROW, not the index, or the next j/k moves the neighbour.
    if (moveMode) {
      const wanted = cursorRowIdRef.current
      const at = wanted === null ? -1 : ids.indexOf(wanted)
      if (at >= 0) {
        if (at !== cursorRef.current) setCursorIndex(at)
        return
      }
    }
    const active = tree.activeRowId
    const activeMoved = active !== prevActiveRef.current
    prevActiveRef.current = active
    const at = active === null ? -1 : ids.indexOf(active)
    if (activeMoved && at >= 0) {
      if (at !== cursorRef.current) setCursorIndex(at)
      return
    }
    if (cursorRef.current >= ids.length) setCursorIndex(Math.max(0, ids.length - 1))
    else if (cursorRef.current < 0 && ids.length > 0) setCursorIndex(at >= 0 ? at : 0)
  }, [tree.flatIds, tree.activeRowId, moveMode, setCursorIndex])
  // Deps-less on purpose: runs after every commit, so when the follow effect
  // fires on a flatIds change it reads the PREVIOUS render's row id.
  useEffect(() => {
    cursorRowIdRef.current = tree.flatIds[cursorRef.current] ?? null
  })

  // Top match on every search keystroke. Declared AFTER the follow effect so
  // it wins while a query is open.
  useEffect(() => {
    void search.query
    if (!search.active) return
    setCursorIndex(0)
  }, [search.active, search.query, setCursorIndex])

  /** A worktree row switches task; a tab row switches task AND tab, via the host. */
  const recentTaskRef = useLatest(props.recentTask ?? null)
  const toggleRoutinesRow = tree.toggleRoutinesRow
  const activateRow = useCallback(
    (rowId: string): void => {
      // The routine count row names no task; it only toggles.
      if (toggleRoutinesRow(rowId)) return
      // The "↩ recent" jump row IS its task — ⏎ re-enters that workspace.
      const recent = rowId === RECENT_ROW_ID ? recentTaskRef.current : null
      const { taskId, tabId } = recent ? { taskId: recent.id, tabId: null } : parseRowId(rowId)
      props.onSelect(taskId)
      if (tabId === null) {
        props.onActivate?.(taskId)
        return
      }
      props.onSelectTab?.(taskId, tabId)
      props.onActivate?.(taskId)
    },
    [props.onSelect, props.onActivate, props.onSelectTab, toggleRoutinesRow],
  )
  const activateRowRef = useLatest(activateRow)

  const controllerRef = useRef<ReturnType<typeof createSidebarController> | null>(null)
  if (controllerRef.current === null) {
    controllerRef.current = createSidebarController({
      getCursor: () => cursorRef.current,
      setCursor: setCursorIndex,
      getFlatIds: () => flatIdsRef.current,
      onSelect: (id) => activateRowRef.current(id),
    })
  }
  const ctrl = controllerRef.current

  /**
   * Move mode is SCOPE-AWARE: a tab row moves within its task; a task row
   * within its repo group; a `main` row moves the whole PROJECT, since project
   * order IS the mains' stored order. Every level edge-stops, no wrap.
   */
  const tasksRef = useLatest(props.tasks)
  const moveCursorRow = useCallback(
    (delta: -1 | 1): void => {
      const rowId = flatIdsRef.current[cursorRef.current]
      if (rowId === undefined || rowId === RECENT_ROW_ID) return
      const { taskId, tabId } = parseRowId(rowId)
      if (tabId !== null) {
        props.onMoveTabRequest?.(taskId, tabId, delta)
        return
      }
      const task = tasksRef.current.find((candidate) => candidate.id === taskId)
      if (!task) return
      if (task.kind !== "main") {
        props.onMoveRequest?.(taskId, delta)
        return
      }
      const projectId = tree.projectIdOfTask(taskId)
      if (projectId === null) return
      // No main checkout ⇒ no project position to change; silent.
      const mainId = tree.mainTaskIdOfProject(projectId)
      if (mainId === null) return
      props.onMoveRequest?.(mainId, delta)
    },
    [tree.projectIdOfTask, tree.mainTaskIdOfProject, props.onMoveRequest, props.onMoveTabRequest],
  )

  // A main row drags its PROJECT, so the header wears the move chip.
  const cursorRowId = tree.flatIds[cursorIndex]
  const cursorMove = useMemo((): { projectId: string | null; rowId: string | null } => {
    if (cursorRowId === undefined || cursorRowId === RECENT_ROW_ID) return { projectId: null, rowId: null }
    const { taskId, tabId } = parseRowId(cursorRowId)
    if (tabId === null) {
      const task = props.tasks.find((candidate) => candidate.id === taskId)
      if (task?.kind === "main") return { projectId: tree.projectIdOfTask(taskId), rowId: null }
    }
    return { projectId: null, rowId: cursorRowId }
  }, [cursorRowId, props.tasks, tree.projectIdOfTask])

  const menu = useTreeMenu({
    tree,
    activateRow,
    setCursorIndex,
    onAddTask: props.onAddTask,
    onCloseTab: props.onCloseTab,
    onNewTab: props.onNewTab,
    actions: props,
  })

  // Using the pane's own nav/select keys extinguishes its first-use hint.
  const markKeysUsed = usePaneHintMark("sidebar")

  // Mode priority (menu > search > move > main) lives in the hook's `enabled` guards.
  useTreeBindings({
    focused,
    search,
    menu,
    moveMode,
    onMoveModeExit: props.onMoveModeExit,
    controller: ctrl,
    flatIdsRef,
    cursorRef,
    moveCursorRow,
    onDeleteRequest: props.onDeleteRequest,
    onRenameRequest: props.onRenameRequest,
    onPinRequest: props.onPinRequest,
    onLocalMergeRequest: props.onLocalMergeRequest,
    markKeysUsed,
  })

  // Viewport follow; rowEls is keyed by flat index.
  const scrollRef = useRef<ScrollBoxRenderable | null>(null)
  const rowElsRef = useRef<Map<number, BoxRenderable> | null>(null)
  if (rowElsRef.current === null) rowElsRef.current = new Map()
  const rowEls = rowElsRef.current
  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll || cursorIndex < 0 || scroll.viewport.height <= 0) return
    const el = rowEls.get(cursorIndex)
    if (el) scroll.scrollChildIntoView(el.id)
  }, [cursorIndex, rowEls])

  const outerRef = useRef<BoxRenderable | null>(null)
  const effectiveWidth = props.width ?? SIDEBAR_WIDTH
  useEffect(() => {
    const el = outerRef.current
    if (!el) return
    // opentui's width setter force-zeroes flexShrink — restore it here.
    el.width = effectiveWidth
    el.flexShrink = 1
    el.minHeight = 0
  }, [effectiveWidth])

  const shared: TreeRowShared = {
    width: effectiveWidth,
    cursorIndex,
    activeRowId: tree.activeRowId,
    selectedTaskId: props.selectedId,
    movingRowId: moveMode ? cursorMove.rowId : null,
    rowEls,
    onPress: (flatIndex, rowId) => {
      menu.close()
      setCursorIndex(flatIndex)
      activateRow(rowId)
    },
    onContextMenu: menu.openForRow,
    branchTick,
    engineTabState: props.engineTabState,
    engineLifecycle: props.engineLifecycle,
    taskJobs: props.taskJobs,
    rowTokens: props.rowTokens,
    worktreeChanges: props.worktreeChanges,
  }

  return (
    <box
      ref={outerRef}
      flexGrow={1}
      minHeight={0}
      flexDirection="column"
      backgroundColor={theme.backgroundPanel}
      // 1, not 0: the neighbouring panes' top FRAME border eats their row 0,
      // so the borderless rail needs one padding row to align with them.
      paddingTop={1}
      paddingBottom={1}
    >
      <SidebarBrandHeader
        focused={focused}
        status={props.headerStatus ?? null}
        onStatusClick={props.onHeaderStatusClick}
        update={props.updateChip ?? null}
        onUpdateClick={props.onUpdateChipClick}
      />
      <SidebarCreateAction onAddTask={props.onAddTask} />
      {search.active ? (
        <SidebarSearchInput query={search.query} matchCount={tree.flatIds.length} totalCount={tree.totalCount} />
      ) : null}
      {/* Rail below the search row (owner 2026-08-02) — Kanban/Routines live
          within the workspace you're in, so they read as children of it. */}
      <SidebarNavRail nav={props.nav ?? "terminal"} setNav={(next) => props.onNavChange?.(next)} />
      <SidebarTreeBody
        rows={tree.rows}
        flatIndexOf={flatIndexOf}
        searching={search.active && search.query.trim().length > 0}
        shared={shared}
        onProjectContextMenu={menu.openForProject}
        movingProjectId={moveMode ? cursorMove.projectId : null}
        setScrollRef={(r) => {
          scrollRef.current = r
        }}
      />
      {/* Zen chip and fold chevron share the rail's last row: two controls
          over one line of a panel whose vertical space is the scarce thing.
          The empty left slot keeps the chevron on the right when zen is off. */}
      {props.zenActive || props.onToggleCollapsed ? (
        <box
          flexShrink={0}
          flexDirection="row"
          justifyContent="space-between"
          paddingLeft={1}
          paddingRight={1}
          paddingTop={1}
        >
          {props.zenActive ? <SidebarZenChip onZenClick={props.onZenClick} /> : <box flexShrink={0} />}
          {props.onToggleCollapsed ? (
            <CollapseButton collapsed={false} inline onToggle={props.onToggleCollapsed} />
          ) : null}
        </box>
      ) : null}
      {menu.open ? (
        <ContextMenu
          entries={menu.entries}
          cursor={menu.cursor}
          x={menu.x}
          y={menu.y}
          // Clamp to the RAIL: past its right edge the menu clips under the workspace.
          dims={{ width: effectiveWidth, height: dims.height }}
          onPick={menu.pick}
        />
      ) : null}
      {/* Terminal dimensions are read so the body re-measures on resize. */}
      {dims.height < 0 ? <text>{""}</text> : null}
    </box>
  )
}
