/** @jsxImportSource @opentui/react */
/**
 * The tree sidebar: project → Task → child Tasks. Everything starts
 * expanded; the collapse sets hold only what you folded by hand. The cursor
 * indexes one flat id list of tasks.
 */

import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core"
import { subscribeBackgroundPolls } from "@sma1lboy/rove-core/lib/background-poll.ts"
import type { Task } from "@sma1lboy/rove-core/types/task.ts"
import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createSidebarController } from "../../../tui/panes/sidebar/controller"
import { RECENT_ROW_ID } from "../../../tui/panes/sidebar/tree-core"
import { SIDEBAR_WIDTH } from "../../../tui/panes/sidebar/view-core"
import { useOptionalKV } from "../../context/kv"
import { useTheme } from "../../context/theme"
import { useLatest } from "../../lib/use-latest"
import { useTerminalSize } from "../../lib/use-terminal-size"
import { ContextMenu } from "../../ui/context-menu"
import { useMachineRows } from "../../workspace/hub-singleton"
import {
  SidebarBrandHeader,
  SidebarCreateAction,
  SidebarNavRail,
  SidebarSearchInput,
  SidebarSettingsRow,
} from "./chrome"
import { CollapseButton } from "./collapse-button"
import { SidebarTreeBody } from "./tree-panel"
import type { TreeRowShared } from "./tree-row-shell"
import type { SidebarProps } from "./types"
import { SidebarUsageLines } from "./usage-lines"
import { cursorTaskIdOf, useTreeBindings } from "./use-tree-bindings"
import { useTreeMenu } from "./use-tree-menu"
import { useTreeSearch } from "./use-tree-search"
import { useTreeState } from "./use-tree-state"

const RAIL_GUTTER = 1

export type SidebarTreeProps = SidebarProps & {
  /** Open a new conversation ("chat" — the ctrl+e picker) or a bare shell tab
   *  in any worktree — offered by the worktree row's menu. */
  onNewTab?: (taskId: string, kind: "chat" | "shell" | "continue") => void
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
  const dims = useTerminalSize()

  // Bumps only when a git poll lands a changed value: rows poll on the shared
  // poll clock, so an unchanged poll renders nothing.
  const [branchTick, setBranchTick] = useState(0)
  useEffect(() => subscribeBackgroundPolls(() => setBranchTick((n) => n + 1)), [])

  const machines = useMachineRows()
  const search = useTreeSearch({ focused, onActiveChange: props.onSearchActiveChange })
  const tree = useTreeState({
    tasks: props.tasks,
    kv,
    selectedTaskId: props.selectedId,
    query: search.active ? search.query : undefined,
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
  // Follow an active-row change during render, so a row click lands the cursor
  // in the selection commit instead of a nested one from the effect below.
  const [followedActive, setFollowedActive] = useState(tree.activeRowId)
  if (props.moveMode !== true && tree.activeRowId !== followedActive) {
    setFollowedActive(tree.activeRowId)
    const at = tree.activeRowId === null ? -1 : (flatIndexOf.get(tree.activeRowId) ?? -1)
    if (at >= 0 && at !== cursorIndex) {
      cursorRef.current = at
      setCursorIndexState(at)
    }
  }
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
  // The row under the cursor LAST render; reorders follow its identity.
  const cursorRowIdRef = useRef<string | null>(null)
  const wasSearching = useRef(false)
  const moveMode = props.moveMode === true
  useEffect(() => {
    const leavingSearch = wasSearching.current && !search.active
    wasSearching.current = search.active
    const ids = tree.flatIds
    // An external selection wins outside move mode; otherwise retain the cursor's row.
    if (moveMode || tree.activeRowId === prevActiveRef.current) {
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
    if (leavingSearch) {
      setCursorIndex(at >= 0 ? at : 0)
      return
    }
    if (cursorRef.current >= ids.length) setCursorIndex(Math.max(0, ids.length - 1))
    else if (cursorRef.current < 0 && ids.length > 0) setCursorIndex(at >= 0 ? at : 0)
  }, [tree.flatIds, tree.activeRowId, moveMode, search.active, setCursorIndex])
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

  /** A task row switches to its task; the host enters it on ⏎. */
  const recentTaskRef = useLatest(props.recentTask ?? null)
  const activateRow = useCallback(
    (rowId: string): void => {
      // The "↩ recent" jump row IS its task — ⏎ re-enters that workspace.
      const recent = rowId === RECENT_ROW_ID ? recentTaskRef.current : null
      const taskId = recent ? recent.id : rowId
      props.onSelect(taskId)
      props.onActivate?.(taskId)
    },
    [props.onSelect, props.onActivate],
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

  /** Move mode: a task row moves within its repo group; it edge-stops, no wrap. */
  const moveCursorRow = useCallback(
    (delta: -1 | 1): void => {
      const taskId = flatIdsRef.current[cursorRef.current]
      if (taskId === undefined || taskId === RECENT_ROW_ID) return
      props.onMoveRequest?.(taskId, delta)
    },
    [props.onMoveRequest],
  )

  const cursorRowId = tree.flatIds[cursorIndex]
  const cursorMove = useMemo(
    (): { projectId: string | null; rowId: string | null } => ({
      projectId: null,
      rowId: cursorRowId === undefined || cursorRowId === RECENT_ROW_ID ? null : cursorRowId,
    }),
    [cursorRowId],
  )

  const menu = useTreeMenu({
    tree,
    activateRow,
    setCursorIndex,
    onAddTask: props.onAddTask,
    onNewTab: props.onNewTab,
    actions: props,
  })

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
  // One cell of air on each side, as the web's rail has: rows and their selection sit inside it.
  const innerWidth = effectiveWidth - 2 * RAIL_GUTTER
  useEffect(() => {
    const el = outerRef.current
    if (!el) return
    // opentui's width setter force-zeroes flexShrink — restore it here.
    el.width = effectiveWidth
    el.flexShrink = 1
    el.minHeight = 0
  }, [effectiveWidth])

  const shared: TreeRowShared = {
    width: innerWidth,
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
    onToggleFold: tree.toggleTaskFold,
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
      paddingLeft={RAIL_GUTTER}
      paddingRight={RAIL_GUTTER}
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
        collapsedProjects={search.active ? undefined : tree.collapsedProjects}
        onToggleProject={search.active ? undefined : tree.toggleProject}
        onAddTask={props.onAddTask}
        onProjectContextMenu={menu.openForProject}
        movingProjectId={moveMode ? cursorMove.projectId : null}
        setScrollRef={(r) => {
          scrollRef.current = r
        }}
      />
      {/* The foot, as the web's rail: each engine's quota, then one row holding
          Settings and the fold chevron. */}
      {props.usage ? (
        <box flexShrink={0} paddingTop={1}>
          <SidebarUsageLines usage={props.usage} width={innerWidth} />
        </box>
      ) : null}
      {props.onOpenSettings || props.onToggleCollapsed ? (
        <box
          flexShrink={0}
          flexDirection="row"
          gap={1}
          paddingLeft={1}
          paddingRight={1}
          paddingTop={props.usage ? 0 : 1}
        >
          {props.onOpenSettings ? <SidebarSettingsRow onOpenSettings={props.onOpenSettings} /> : null}
          <box flexGrow={1} />
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
          // Clamped to the screen, so it opens down and right of the pointer; the rail paints over the workspace.
          dims={dims}
          onPick={menu.pick}
          onHover={menu.hover}
          sub={menu.sub}
        />
      ) : null}
      {/* Terminal dimensions are read so the body re-measures on resize. */}
      {dims.height < 0 ? <text>{""}</text> : null}
    </box>
  )
}
