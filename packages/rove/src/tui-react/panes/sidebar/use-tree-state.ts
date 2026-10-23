/**
 * Sidebar tree state: the flat row list and the row id (a task id).
 *
 * Two folds: a project's routine count row (session-scoped on purpose;
 * schedule-created sessions only, and a folded routine stays findable by search
 * and openable from the Inbox and Routines page), and a task's children, open
 * by default and remembered across a restart in `COLLAPSED_TASKS_KEY`.
 *
 * Which tasks show, under which project, comes from `use-sidebar-groups.ts`
 * (shared with the folded rail); this turns that into rows.
 */

import type { TaskEngineState } from "@/client/remote-orchestrator"
import type { Task } from "@/types/task"
import { useCallback, useMemo, useRef, useState } from "react"
import { currentBranch } from "../../../tui/panes/sidebar/git-head"
import { type TaskSortMode, sidebarProjectKeyResolver } from "../../../tui/panes/sidebar/groups"
import { type MachineLayerEntry, applyMachineLayer } from "../../../tui/panes/sidebar/machine-layer"
import {
  type TreeRow,
  buildRowsFromGroups,
  conversationTitleOf,
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

/** KV key holding the ids of tasks whose children are folded away. */
export const COLLAPSED_TASKS_KEY = "sidebar.collapsedTasks"

function readCollapsedTasks(kv: TabsSnapshotKv | null): ReadonlySet<string> {
  const stored = kv?.store[COLLAPSED_TASKS_KEY]
  return new Set(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : [])
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
  const [collapsedTasks, setCollapsedTasks] = useState<ReadonlySet<string>>(() => readCollapsedTasks(kv))
  // The latest set, so a toggle persists what it just built rather than a stale render's.
  const collapsedRef = useRef(collapsedTasks)
  const toggleRoutines = useCallback((projectKey: string): void => {
    setExpandedRoutines((current) => {
      const next = new Set(current)
      if (!next.delete(projectKey)) next.add(projectKey)
      return next
    })
  }, [])
  const toggleTaskFold = useCallback(
    (taskId: string): void => {
      const next = new Set(collapsedRef.current)
      if (!next.delete(taskId)) next.add(taskId)
      collapsedRef.current = next
      setCollapsedTasks(next)
      kv?.set(COLLAPSED_TASKS_KEY, [...next])
    },
    [kv],
  )

  const { groups, tabsByTask } = useSidebarGroups({
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
    const conversationTitles = new Map<string, string>()
    for (const task of tasks) {
      const title = conversationTitleOf(task, tabsByTask)
      if (title) conversationTitles.set(task.id, title)
    }
    const all = buildRowsFromGroups({
      groups,
      conversationTitles,
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
  }, [
    groups,
    tabsByTask,
    tasks,
    searching,
    query,
    recentTask,
    expandedRoutines,
    collapsedTasks,
    machines,
    opts.branchTick,
  ])
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
