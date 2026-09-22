/**
 * Sidebar tree state: the flat row list and row id ↔ (taskId, tabId).
 *
 * The only fold is a project's routine count row (schedule-created sessions
 * only); a folded routine stays findable by search and openable from the
 * Inbox and Routines page. Its open set is NOT persisted: closed is the
 * resting state.
 *
 * Which tasks show, under which project, comes from `use-sidebar-groups.ts`
 * (shared with the folded rail); this turns that into rows.
 */

import type { TaskEngineState } from "@/client/remote-orchestrator"
import type { Task } from "@/types/task"
import { useCallback, useMemo, useState } from "react"
import { currentBranch } from "../../../tui/panes/sidebar/git-head"
import { sidebarProjectKeyOfTask } from "../../../tui/panes/sidebar/groups"
import { taskJumpDigit } from "../../../tui/panes/sidebar/jump-digits"
import { type MachineLayerEntry, applyMachineLayer } from "../../../tui/panes/sidebar/machine-layer"
import { jumpTaskIds } from "../../../tui/panes/sidebar/project-groups"
import {
  type TreeRow,
  buildRowsFromGroups,
  filterTreeRows,
  jumpRowsOf,
  mainTaskIdOfProject,
  projectKeyOfRoutinesRow,
  rowLiveBranchPath,
  tabRowId,
  treeFlatIds,
  withRecentRow,
} from "../../../tui/panes/sidebar/tree-core"
import type { TabsSnapshotKv } from "../../workspace/terminal-tabs-persist"
import { useSidebarGroups } from "./use-sidebar-groups"

export interface TreeStateOpts {
  readonly tasks: readonly Task[]
  /** Null when no KV provider is mounted — see `knownTaskTabs`. */
  readonly kv: TabsSnapshotKv | null
  /** The task whose session the right pane is showing. */
  readonly selectedTaskId: string | null
  /** That task's active tab, so the tree can mark the exact live row. */
  readonly selectedTabId: string | null
  /** Live `/` query. Non-empty prunes the tree to matches + their ancestors. */
  readonly query?: string
  /** Narrow mode's "↩ recent" row, prepended; hidden while a query is open. */
  readonly recentTask?: Task | null
  /** Global task sort applied before shaping the tree. */
  readonly sortMode?: import("../../../tui/panes/sidebar/groups").TaskSortMode
  /** Per-task activity `attention` sort ranks by; the same map the glyphs
   *  read, so order and glyphs can't disagree. */
  readonly engineState?: ReadonlyMap<string, TaskEngineState>
  /** The ~2s poll tick; re-runs search over freshly polled HEADs. */
  readonly branchTick?: number
  /** Registered machines. Absent/empty: no header row, no extra indent. */
  readonly machines?: readonly MachineLayerEntry[]
}

/** Shared, so no machines never invalidates the memo with a fresh literal. */
const EMPTY_MACHINES: readonly MachineLayerEntry[] = []

export interface TreeState {
  readonly rows: readonly TreeRow[]
  readonly flatIds: readonly string[]
  /** Navigable rows before the query pruned anything — the `N/total` suffix. */
  readonly totalCount: number
  /** Tab count; the menu offers close only above one. */
  readonly tabCount: (taskId: string) => number
  /** The row id the right pane is currently showing. */
  readonly activeRowId: string | null
  /** The project a task belongs to, or null for a project-less `dir` task. */
  readonly projectIdOfTask: (taskId: string) => string | null
  /** The task whose move reorders this project (its `main` checkout). */
  readonly mainTaskIdOfProject: (projectId: string) => string | null
  /** Toggle a routine count row; true (press consumed) when `rowId` was one. */
  readonly toggleRoutinesRow: (rowId: string) => boolean
  /** Rows `ctrl+<digit>` reaches, one per task, so slot N is the same session folded or not. */
  readonly jumpRowIds: readonly string[]
  /** The digit a row prints, or null for a row that carries none (a tab row,
   *  the routine count row, anything past the ninth task). */
  readonly jumpDigitOf: (rowId: string) => string | null
}

export function useTreeState(opts: TreeStateOpts): TreeState {
  const { tasks, kv, selectedTaskId, selectedTabId } = opts
  const query = opts.query ?? ""
  const searching = query.trim() !== ""

  // Open routine count rows; session-scoped on purpose.
  const [expandedRoutines, setExpandedRoutines] = useState<ReadonlySet<string>>(() => new Set())
  const toggleRoutines = useCallback((projectKey: string): void => {
    setExpandedRoutines((current) => {
      const next = new Set(current)
      if (!next.delete(projectKey)) next.add(projectKey)
      return next
    })
  }, [])

  const { groups, tabsByTask } = useSidebarGroups({
    tasks,
    kv,
    sortMode: opts.sortMode,
    engineState: opts.engineState,
  })

  const recentTask = opts.recentTask ?? null
  const machines = opts.machines ?? EMPTY_MACHINES
  const { rows, totalCount } = useMemo(() => {
    // Search builds fully expanded so folded routines stay findable;
    // `filterTreeRows` drops the emptied count row.
    const all = buildRowsFromGroups({
      groups,
      tabsByTask,
      expandedRoutines: searching ? new Set(groups.map((group) => group.key)) : expandedRoutines,
    })
    const total = treeFlatIds(all).length
    // Re-run on the poll tick: the HEAD read below is a cache lookup that never re-triggers.
    void opts.branchTick
    // Search matches the label a row RENDERS; branchless rows use the same
    // cached HEAD read `WorktreeTreeRow` renders through.
    const liveBranch = (task: Task): string => {
      const path = rowLiveBranchPath(task)
      return path ? currentBranch(path) : ""
    }
    return {
      // Machine layer runs LAST; with no machines it returns its input unchanged.
      rows: applyMachineLayer(
        searching ? filterTreeRows(all, query, liveBranch) : withRecentRow(all, recentTask),
        machines,
      ),
      totalCount: total,
    }
  }, [groups, tabsByTask, searching, query, recentTask, expandedRoutines, machines, opts.branchTick])
  const flatIds = useMemo(() => treeFlatIds(rows), [rows])

  // Digits number TASKS over the shared groups; `jumpRowsOf` maps them to rows here.
  const jump = useMemo(() => {
    const rowIds = jumpRowsOf(rows, new Set(jumpTaskIds(groups)))
    const digitOfRow = new Map<string, string>()
    rowIds.forEach((rowId, slot) => {
      const digit = taskJumpDigit(slot)
      if (digit !== null) digitOfRow.set(rowId, digit)
    })
    return { digitOfRow, rowIds }
  }, [rows, groups])

  // The deepest row naming the session: the ACTIVE TAB, else the worktree row.
  const activeRowId = useMemo(() => {
    if (selectedTaskId === null) return null
    if (selectedTabId !== null) return tabRowId(selectedTaskId, selectedTabId)
    return selectedTaskId
  }, [selectedTaskId, selectedTabId])

  const tabCount = useCallback((taskId: string): number => tabsByTask.get(taskId)?.length ?? 0, [tabsByTask])

  const mainTaskOfProject = useCallback(
    (projectId: string): string | null => mainTaskIdOfProject(tasks, projectId),
    [tasks],
  )
  const projectIdOfTask = useCallback(
    (taskId: string): string | null => {
      const task = tasks.find((candidate) => candidate.id === taskId)
      if (!task || task.kind === "dir") return null
      return sidebarProjectKeyOfTask(task)
    },
    [tasks],
  )

  return {
    rows,
    flatIds,
    totalCount,
    jumpRowIds: jump.rowIds,
    jumpDigitOf: useCallback((rowId: string) => jump.digitOfRow.get(rowId) ?? null, [jump]),
    tabCount,
    activeRowId,
    projectIdOfTask,
    mainTaskIdOfProject: mainTaskOfProject,
    /** True when `rowId` WAS a routine row: the press is consumed. */
    toggleRoutinesRow: useCallback(
      (rowId: string): boolean => {
        const projectKey = projectKeyOfRoutinesRow(rowId)
        if (projectKey === null) return false
        toggleRoutines(projectKey)
        return true
      },
      [toggleRoutines],
    ),
  }
}
