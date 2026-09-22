/**
 * Sidebar tree state — the flat row list and the cursor's translation
 * between row ids and the terminal's (taskId, tabId) pair.
 *
 * Kept out of `tree-core.ts` because that module is framework-free — vitest
 * loads it in Node — while this one is React state; the fold and expansion
 * rules below need that separation to stay testable as plain data.
 *
 * There is NO fold anywhere except one: a project's routine count row, which
 * folds ONLY the standing sessions a schedule created. Every project and every
 * task a human opened still shows everything under it. The tree is a map, not
 * a filing cabinet — hiding rows makes the map lie, and the exception is
 * scoped so it can't: a folded routine stays findable by search, and openable
 * from the Inbox and the Routines page.
 *
 * The expansion set is deliberately NOT persisted: it resets closed each
 * session, because the resting state that keeps the sidebar readable is the
 * closed one.
 *
 * WHICH tasks are on screen, and under which project, is NOT decided here:
 * that answer is shared with the folded rail (`use-sidebar-groups.ts`), and
 * this module turns it into rows. The tab projection it reads from is shared
 * the same way (`use-tabs-by-task.ts`), because "does this task have tabs" is
 * what the hide rules turn on — so the rail needs it too.
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
  /** Narrow mode's "↩ recent" jump target — prepended as the first navigable
   *  row. Hidden while a search query is open (you are hunting, not going
   *  back). Absent/null = no row. */
  readonly recentTask?: Task | null
  /** Global task sort applied before shaping the tree. */
  readonly sortMode?: import("../../../tui/panes/sidebar/groups").TaskSortMode
  /** Daemon-pushed per-task activity — what `attention` sort ranks by. The
   *  same map the rows render their state glyph from, so the order and the
   *  glyphs can never disagree about which row is stopped. */
  readonly engineState?: ReadonlyMap<string, TaskEngineState>
  /** The sidebar's ~2s poll tick. Re-runs the search over freshly resolved
   *  HEADs, so a `main` row becomes findable by its branch as soon as the
   *  poller answers rather than only on the next unrelated re-render. */
  readonly branchTick?: number
  /** Registered machines. Absent/empty leaves the tree exactly as it was
   *  before machines existed — no header row, no extra indent. */
  readonly machines?: readonly MachineLayerEntry[]
}

/** One shared empty array, so an install with no machines never invalidates
 *  the tree memo on a fresh literal. */
const EMPTY_MACHINES: readonly MachineLayerEntry[] = []

export interface TreeState {
  readonly rows: readonly TreeRow[]
  readonly flatIds: readonly string[]
  /** Navigable rows before the query pruned anything — the `N/total` suffix. */
  readonly totalCount: number
  /** How many tabs this worktree has — the menu needs the count to know
   *  whether closing one is possible. */
  readonly tabCount: (taskId: string) => number
  /** The row id the right pane is currently showing. */
  readonly activeRowId: string | null
  /** The project a task belongs to, or null for a project-less `dir` task. */
  readonly projectIdOfTask: (taskId: string) => string | null
  /** The task whose move reorders this project (its `main` checkout). */
  readonly mainTaskIdOfProject: (projectId: string) => string | null
  /** Toggle a project's routine count row. True when `rowId` was
   *  one — the press is then consumed, and no task activation follows. */
  readonly toggleRoutinesRow: (rowId: string) => boolean
  /** The rows `ctrl+<digit>` reaches, in slot order — one per task the fold
   *  and the tree both show, so slot N is the same session in either. */
  readonly jumpRowIds: readonly string[]
  /** The digit a row prints, or null for a row that carries none (a tab row,
   *  the routine count row, anything past the ninth task). */
  readonly jumpDigitOf: (rowId: string) => string | null
}

export function useTreeState(opts: TreeStateOpts): TreeState {
  const { tasks, kv, selectedTaskId, selectedTabId } = opts
  const query = opts.query ?? ""
  const searching = query.trim() !== ""

  // Which projects' routine count rows are OPEN. Session-scoped
  // on purpose: closed is the resting state worth returning to, so this
  // never reaches a store.
  const [expandedRoutines, setExpandedRoutines] = useState<ReadonlySet<string>>(() => new Set())
  const toggleRoutines = useCallback((projectKey: string): void => {
    setExpandedRoutines((current) => {
      const next = new Set(current)
      if (!next.delete(projectKey)) next.add(projectKey)
      return next
    })
  }, [])

  // Selection, grouping and order come from ONE place, shared with the folded
  // rail (`use-sidebar-groups.ts`). Everything below this line is the tree's
  // own presentation of that answer.
  const { groups, tabsByTask } = useSidebarGroups({
    tasks,
    kv,
    sortMode: opts.sortMode,
    engineState: opts.engineState,
  })

  const recentTask = opts.recentTask ?? null
  const machines = opts.machines ?? EMPTY_MACHINES
  const { rows, totalCount } = useMemo(() => {
    // A SEARCH builds the tree fully expanded: folding the routine
    // sessions away at rest must not make them unfindable, and search is how
    // you reach one without opening the fold first. `filterTreeRows` then
    // drops the (now empty) count row itself.
    const all = buildRowsFromGroups({
      groups,
      tabsByTask,
      expandedRoutines: searching ? new Set(groups.map((group) => group.key)) : expandedRoutines,
    })
    const total = treeFlatIds(all).length
    // Dependency-only invalidation key: re-run the search when the poll tick
    // moves, so a `main` row becomes findable by its branch as soon as the
    // HEAD poller answers (the read below is a plain cache lookup, which on
    // its own would never re-trigger this memo).
    void opts.branchTick
    // Search matches a worktree row on the label it RENDERS, and the rows that
    // own no branch (main / dir) are labelled by their polled HEAD — the same
    // cached read `WorktreeTreeRow` renders through, so the query sees exactly
    // the branch name printed on the row. The poll itself is the row's effect;
    // this is a plain synchronous cache read.
    const liveBranch = (task: Task): string => {
      const path = rowLiveBranchPath(task)
      return path ? currentBranch(path) : ""
    }
    return {
      // The machine layer runs LAST, over the finished tree: with no machine
      // registered it returns the very array it was handed, so a zero-machine
      // sidebar is byte-identical to what it was before machines existed.
      rows: applyMachineLayer(
        searching ? filterTreeRows(all, query, liveBranch) : withRecentRow(all, recentTask),
        machines,
      ),
      totalCount: total,
    }
  }, [groups, tabsByTask, searching, query, recentTask, expandedRoutines, machines, opts.branchTick])
  const flatIds = useMemo(() => treeFlatIds(rows), [rows])

  // The jump digit belongs to a TASK, numbered over the groups the fold reads
  // too — so a slot means the same session in either state. `jumpRowsOf` maps
  // those tasks onto the rows THIS surface prints the numbers on.
  const jump = useMemo(() => {
    const rowIds = jumpRowsOf(rows, new Set(jumpTaskIds(groups)))
    const digitOfRow = new Map<string, string>()
    rowIds.forEach((rowId, slot) => {
      const digit = taskJumpDigit(slot)
      if (digit !== null) digitOfRow.set(rowId, digit)
    })
    return { digitOfRow, rowIds }
  }, [rows, groups])

  // The active row is the selected task's ACTIVE TAB, else the worktree row
  // itself — the highlight lands on the deepest row that names the session.
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
    /** Open/close a project's routine count row. Returns true when
     *  `rowId` WAS a routine row, so the caller knows the press was consumed
     *  and must not also try to activate a task by that id. */
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

/** Re-exported so the Sidebar can translate a cursor row id without also
 *  importing the core module directly. */
