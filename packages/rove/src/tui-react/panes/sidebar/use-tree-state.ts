/**
 * Sidebar tree state: the flat row list and the row id (a task id).
 *
 * Two folds, both session-scoped on purpose (closed/open is not remembered
 * across a restart): a project's routine count row (schedule-created sessions
 * only; a folded routine stays findable by search and openable from the Inbox
 * and Routines page), and a task's children, open by default.
 *
 * Which tasks show, under which project, comes from `use-sidebar-groups.ts`
 * (shared with the folded rail); this turns that into rows.
 */

import type { TaskEngineState } from "@/client/remote-orchestrator"
import type { Task } from "@/types/task"
import { useCallback, useMemo, useState } from "react"
import { currentBranch } from "../../../tui/panes/sidebar/git-head"
import { type TaskSortMode, sidebarProjectKeyResolver } from "../../../tui/panes/sidebar/groups"
import { type MachineLayerEntry, applyMachineLayer } from "../../../tui/panes/sidebar/machine-layer"
import {
  type TreeRow,
  buildRowsFromGroups,
  filterTreeRows,
  mainTaskIdOfProject,
  projectKeyOfRoutinesRow,
  rowLiveBranchPath,
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
  /** Live `/` query. Non-empty prunes the tree to matches + their ancestors. */
  readonly query?: string
  /** Narrow mode's "↩ recent" row, prepended; hidden while a query is open. */
  readonly recentTask?: Task | null
  /** Global task sort applied before shaping the tree. */
  readonly sortMode?: TaskSortMode
  /** Per-task activity `attention` sort ranks by; the same map the glyphs
   *  read, so order and glyphs can't disagree. */
  readonly engineState?: ReadonlyMap<string, TaskEngineState>
  /** Bumps when a git poll lands a changed value; re-runs search over fresh HEADs. */
  readonly branchTick?: number
  /** Registered machines: stamps each remote row with its machine's state (the cloud mark).
   *  Absent/empty: rows come back untouched. */
  readonly machines?: readonly MachineLayerEntry[]
}

/** Shared, so no machines never invalidates the memo with a fresh literal. */
const EMPTY_MACHINES: readonly MachineLayerEntry[] = []

export interface TreeState {
  readonly rows: readonly TreeRow[]
  readonly flatIds: readonly string[]
  /** Navigable rows before the query pruned anything — the `N/total` suffix. */
  readonly totalCount: number
  /** The row id the right pane is currently showing. */
  readonly activeRowId: string | null
  /** The project a task belongs to, or null for a project-less `dir` task. */
  readonly projectIdOfTask: (taskId: string) => string | null
  /** The task whose move reorders this project (its `main` checkout). */
  readonly mainTaskIdOfProject: (projectId: string) => string | null
  /** Toggle a routine count row; true (press consumed) when `rowId` was one. */
  readonly toggleRoutinesRow: (rowId: string) => boolean
  /** Fold or unfold a task's children. */
  readonly toggleTaskFold: (taskId: string) => void
}

export function useTreeState(opts: TreeStateOpts): TreeState {
  const { tasks, kv, selectedTaskId } = opts
  const query = opts.query ?? ""
  const searching = query.trim() !== ""

  // Open routine count rows, and tasks whose children are folded away.
  const [expandedRoutines, setExpandedRoutines] = useState<ReadonlySet<string>>(() => new Set())
  const [collapsedTasks, setCollapsedTasks] = useState<ReadonlySet<string>>(() => new Set())
  const toggleRoutines = useCallback((projectKey: string): void => {
    setExpandedRoutines((current) => {
      const next = new Set(current)
      if (!next.delete(projectKey)) next.add(projectKey)
      return next
    })
  }, [])
  const toggleTaskFold = useCallback((taskId: string): void => {
    setCollapsedTasks((current) => {
      const next = new Set(current)
      if (!next.delete(taskId)) next.add(taskId)
      return next
    })
  }, [])

  const { groups } = useSidebarGroups({
    tasks,
    kv,
    sortMode: opts.sortMode,
    engineState: opts.engineState,
  })

  const recentTask = opts.recentTask ?? null
  const machines = opts.machines ?? EMPTY_MACHINES
  const { rows, totalCount } = useMemo(() => {
    // Search builds fully expanded so folded rows stay findable;
    // `filterTreeRows` drops the emptied count row.
    const all = buildRowsFromGroups({
      groups,
      expandedRoutines: searching ? new Set(groups.map((group) => group.key)) : expandedRoutines,
      collapsedTasks: searching ? undefined : collapsedTasks,
    })
    const total = treeFlatIds(all).length
    // Re-run when a poll lands: the HEAD read below is a cache lookup that never re-triggers.
    void opts.branchTick
    // Search matches the label a row RENDERS; branchless rows use the same
    // cached HEAD read `WorktreeTreeRow` renders through.
    const liveBranch = (task: Task): string => {
      const path = rowLiveBranchPath(task)
      return path ? currentBranch(path) : ""
    }
    return {
      // Machine layer runs LAST; it adds no rows, and with no machines it returns its input unchanged.
      rows: applyMachineLayer(
        searching ? filterTreeRows(all, query, liveBranch) : withRecentRow(all, recentTask),
        machines,
      ),
      totalCount: total,
    }
  }, [groups, searching, query, recentTask, expandedRoutines, collapsedTasks, machines, opts.branchTick])
  const flatIds = useMemo(() => treeFlatIds(rows), [rows])

  // One task = one conversation, so the row naming what the right pane shows is the task's.
  const activeRowId = selectedTaskId

  const mainTaskOfProject = useCallback(
    (projectId: string): string | null => mainTaskIdOfProject(tasks, projectId),
    [tasks],
  )
  // The merged project a task sits under — another machine's checkout of the
  // same repo answers the home checkout's key, as the tree renders it.
  const projectKeyOf = useMemo(() => sidebarProjectKeyResolver(tasks), [tasks])
  const projectIdOfTask = useCallback(
    (taskId: string): string | null => {
      const task = tasks.find((candidate) => candidate.id === taskId)
      if (!task || task.kind === "dir") return null
      return projectKeyOf(task)
    },
    [tasks, projectKeyOf],
  )

  return {
    rows,
    flatIds,
    totalCount,
    activeRowId,
    projectIdOfTask,
    mainTaskIdOfProject: mainTaskOfProject,
    toggleTaskFold,
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
