/**
 * Sidebar tree state: the flat row list and the row id (a task id).
 *
 * Three folds: the Archived row at the end (session-scoped, left out of a
 * search), a project's routine count row (session-scoped on purpose;
 * schedule-created sessions only, and a folded routine stays findable by search
 * and openable from the Inbox and Routines page), and a task's children, open
 * unless the parent is crowded (`AUTO_FOLD_CHILDREN`); folds and opens the
 * user made are remembered across a restart in `COLLAPSED_TASKS_KEY` / `OPENED_TASKS_KEY`.
 *
 * Which tasks show, under which project, comes from `use-sidebar-groups.ts`
 * (shared with the folded rail); this turns that into rows.
 */

import type { TaskEngineState } from "@/client/remote-orchestrator"
import type { Task } from "@/types/task"
import { useCallback, useMemo, useRef, useState } from "react"
import type { TaskSortMode } from "../../../sidebar/groups"
import type { TabsSnapshotKv } from "../../../tabs/terminal-tabs-persist"
import { currentBranch } from "../../../tui/panes/sidebar/git-head"
import { type MachineLayerEntry, applyMachineLayer } from "../../../tui/panes/sidebar/machine-layer"
import {
  type TreeRow,
  buildRowsFromGroups,
  filterTreeRows,
  rowLiveBranchPath,
  treeFlatIds,
  withRecentRow,
} from "../../../tui/panes/sidebar/tree-core"
import type { KVContext } from "../../context/kv"
import { useSidebarGroups } from "./use-sidebar-groups"

export interface TreeStateOpts {
  readonly tasks: readonly Task[]
  /** Null when no KV provider is mounted — see `knownTaskTabs`. */
  readonly kv: FoldKv | null
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
  /** Registered machines: stamps each remote row with its machine's state.
   *  Absent/empty: rows come back untouched. */
  readonly machines?: readonly MachineLayerEntry[]
}

/** KV key holding the ids of tasks whose children are folded away. */
export const COLLAPSED_TASKS_KEY = "sidebar.collapsedTasks"
/** KV key holding the ids of crowded parents the user opened past the automatic fold. */
export const OPENED_TASKS_KEY = "sidebar.openedTasks"

const COLLAPSED_PROJECTS_KEY = "sidebar.collapsedProjects"

interface Folds {
  readonly collapsed: ReadonlySet<string>
  readonly opened: ReadonlySet<string>
}

type FoldKv = TabsSnapshotKv & Pick<KVContext, "update">

function idsOf(stored: unknown): Set<string> {
  return new Set(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : [])
}

function readIds(kv: FoldKv | null, key: string): ReadonlySet<string> {
  return idsOf(kv?.store[key])
}

/** Adds or drops one id against the list on disk, not this window's copy: another window's folds survive. */
function persistId(kv: FoldKv | null, key: string, id: string, present: boolean): void {
  kv?.update(key, (current) => {
    const ids = idsOf(current)
    if (present) ids.add(id)
    else ids.delete(id)
    return [...ids]
  })
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
  /** Search is open, including while its field is empty. */
  readonly searching: boolean
  /** Fold or unfold a task's children. */
  readonly collapsedProjects: ReadonlySet<string>
  readonly toggleProject: (id: string) => void
  readonly toggleTaskFold: (taskId: string) => void
}

export function useTreeState(opts: TreeStateOpts): TreeState {
  const { tasks, kv, selectedTaskId } = opts
  const query = opts.query ?? ""
  const searching = opts.query !== undefined
  const [collapsedProjects, setCollapsedProjects] = useState(() => readIds(kv, COLLAPSED_PROJECTS_KEY))
  const toggleProject = (id: string): void => {
    const next = new Set(collapsedProjects)
    const folding = !next.delete(id)
    if (folding) next.add(id)
    setCollapsedProjects(next)
    persistId(kv, COLLAPSED_PROJECTS_KEY, id, folding)
  }

  // The folds the user set by hand over the automatic rule.
  const [folds, setFolds] = useState<Folds>(() => ({
    collapsed: readIds(kv, COLLAPSED_TASKS_KEY),
    opened: readIds(kv, OPENED_TASKS_KEY),
  }))
  // The latest folds and rows, so a toggle persists what it just built and flips what is on screen.
  const foldsRef = useRef(folds)
  const rowsRef = useRef<readonly TreeRow[]>([])
  const toggleTaskFold = useCallback(
    (taskId: string): void => {
      const row = rowsRef.current.find((candidate) => candidate.kind === "worktree" && candidate.id === taskId)
      const wasFolded = row?.kind === "worktree" && row.fold?.collapsed === true
      const collapsed = new Set(foldsRef.current.collapsed)
      const opened = new Set(foldsRef.current.opened)
      if (wasFolded) {
        collapsed.delete(taskId)
        opened.add(taskId)
      } else {
        opened.delete(taskId)
        collapsed.add(taskId)
      }
      const next = { collapsed, opened }
      foldsRef.current = next
      setFolds(next)
      persistId(kv, COLLAPSED_TASKS_KEY, taskId, !wasFolded)
      persistId(kv, OPENED_TASKS_KEY, taskId, wasFolded)
    },
    [kv],
  )

  const { groups } = useSidebarGroups({
    tasks,
    kv,
    sortMode: opts.sortMode,
    engineState: opts.engineState,
  })

  const recentTask = opts.recentTask ?? null
  const machines = opts.machines ?? EMPTY_MACHINES
  const { rows, totalCount } = useMemo(() => {
    // Search builds with no task folds so folded rows stay findable.
    const all = buildRowsFromGroups({
      groups,
      collapsedProjects: searching ? undefined : collapsedProjects,
      collapsedTasks: searching ? undefined : folds.collapsed,
      openedTasks: folds.opened,
      selectedTaskId: selectedTaskId ?? undefined,
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
  }, [groups, collapsedProjects, searching, query, recentTask, folds, selectedTaskId, machines, opts.branchTick])
  rowsRef.current = rows
  const flatIds = useMemo(() => treeFlatIds(rows), [rows])

  // One task = one conversation, so the row naming what the right pane shows is the task's.
  const activeRowId = selectedTaskId

  return {
    rows,
    flatIds,
    totalCount,
    activeRowId,
    searching,
    collapsedProjects,
    toggleProject,
    toggleTaskFold,
  }
}
