/**
 * Sidebar tree shaping — project → Task → Terminal Tab, as ONE flat row list
 * with `depth`. This module owns the shape; the renderer owns the glyphs.
 *
 * Flat because navigation is one cursor over `flatTaskIds` (`controller.ts`):
 * j/k/gg/search/ctrl+digit extend to tab rows with no parallel traversal.
 *
 * Row ids must be unique across kinds: task id, or `${taskId}::${tabId}` —
 * the same composite the PTY registry uses for tab keys.
 */

import type { Task } from "@/types/task"
import type { VendorId } from "../../../types/vendor"
import { sidebarProjectKeyOfTask } from "./groups"
import { type SidebarGroup, type SidebarGroupInput, buildSidebarGroups, ownTasks } from "./project-groups"
import { RECENT_ROW_ID, SCRATCH_SECTION_ID, routinesRowId, tabRowId } from "./tree-ids"

// Re-exported so callers name the whole tree vocabulary from one module.
export { filterTreeRows } from "./tree-search"
export {
  RECENT_ROW_ID,
  SCRATCH_SECTION_ID,
  machineRowId,
  parseRowId,
  projectKeyOfRoutinesRow,
  tabRowId,
} from "./tree-ids"
export { rowLiveBranchPath, worktreeRowLabel } from "./tree-labels"

/** One shared grouping (project-groups.ts), so tree and folded rail agree on which projects exist. */
export { ownerProjectKey, projectKeysOf } from "./project-groups"

/** The tree's projection of a tab (the tab module owns the real shape). */
export interface TreeTab {
  readonly id: string
  /** Already-resolved display name; precedence is the tab module's job. */
  readonly label: string
  /** The task's ACTIVE tab — carries the session's state glyph. */
  readonly active?: boolean
  /** Coding-agent tab. Shell/command/content tabs always wear the plain dot. */
  readonly engine?: boolean
  /**
   * Engine running in the tab now, from the pty's process tree
   * (`liveEngines.resolve`), else the tab's recorded identity. An observation,
   * not config. `null`/absent = not an engine, or nothing answered.
   */
  readonly liveVendor?: VendorId | null
  /**
   * Freeze-restored: scrollback kept, process gone; the next open respawns
   * the recorded launch command. Otherwise looks like a quiet tab.
   */
  readonly restored?: boolean
}

export type TreeRow =
  /** Header for another computer's Rove daemon; emitted only when a machine is registered. */
  | {
      readonly kind: "machine"
      readonly id: string
      readonly alias: string
      readonly label: string
      readonly state: MachineRowState
      readonly version?: string
      readonly depth: 0
    }
  | {
      readonly kind: "project"
      readonly id: string
      readonly repo: string
      readonly label: string
      /** Which machine's checkout this is; `"local"` for this computer. */
      readonly machineId: string
      readonly depth: number
    }
  | { readonly kind: "worktree"; readonly id: string; readonly task: Task; readonly depth: number }
  | {
      readonly kind: "tab"
      readonly id: string
      readonly task: Task
      readonly tab: TreeTab
      readonly depth: number
    }
  | { readonly kind: "recent"; readonly id: typeof RECENT_ROW_ID; readonly task: Task; readonly depth: number }
  /**
   * One row folding a project's routine session tasks (7 daily routines =
   * 49 rows a week). Opening reveals them; they're never removed from data.
   */
  | {
      readonly kind: "routines"
      readonly id: string
      /** Project key these routines belong to — the row sits under it. */
      readonly projectKey: string
      readonly count: number
      readonly expanded: boolean
      readonly depth: number
    }

/** `mismatch` = remote protocol range this build can't speak; affects only that row. */
export type MachineRowState = "connecting" | "online" | "offline" | "unsupported" | "mismatch"

/** Prepend "↩ recent: <task>" (narrow mode; caller gates): one keystroke back after a cold reconnect. */
export function withRecentRow(rows: readonly TreeRow[], recent: Task | null): TreeRow[] {
  if (!recent) return [...rows]
  return [{ kind: "recent", id: RECENT_ROW_ID, task: recent, depth: 1 }, ...rows]
}

export interface TreeInput extends SidebarGroupInput {
  /** Absent task = tabs never mounted (not the same as none); no tab rows. */
  readonly tabsByTask: ReadonlyMap<string, readonly TreeTab[]>
  /** Project keys whose routine row is open; absent = all closed. */
  readonly expandedRoutines?: ReadonlySet<string>
}

export interface TreeRowsInput {
  /** The sections to render, already selected, grouped and ordered. */
  readonly groups: readonly SidebarGroup[]
  readonly tabsByTask: ReadonlyMap<string, readonly TreeTab[]>
  readonly expandedRoutines?: ReadonlySet<string>
}

/**
 * Sections → flat rows. Presentation only: membership and order come from
 * `buildSidebarGroups`, which the folded rail also reads.
 *
 * A `main` task is the first worktree row under its project, not the project
 * row: the header is a repo, not a checkout, so main can carry tabs.
 */
export function buildRowsFromGroups(input: TreeRowsInput): TreeRow[] {
  const { tabsByTask } = input
  const rows: TreeRow[] = []
  for (const group of input.groups) {
    // Scratch reuses the project-row shape; its id (SCRATCH_SECTION_ID) can't
    // be a repo path, and the renderer translates the label.
    rows.push({
      kind: "project",
      id: group.key,
      repo: group.repo,
      label: group.label,
      machineId: group.machineId,
      depth: 0,
    })
    if (group.key === SCRATCH_SECTION_ID) {
      // Scratch tasks skip their worktree row (auto name is noise); tabs hang
      // off the header. With tabs unknown (never mounted) the worktree row
      // stays — zero rows would make the task unreachable.
      for (const task of group.tasks) {
        const tabs = tabsByTask.get(task.id) ?? []
        if (tabs.length === 0) {
          rows.push({ kind: "worktree", id: task.id, task, depth: 1 })
          continue
        }
        for (const tab of tabs) {
          rows.push({ kind: "tab", id: tabRowId(task.id, tab.id), task, tab, depth: 2 })
        }
      }
      continue
    }
    // Routine sessions are the TAIL of `group.tasks`; the count row sits at the seam.
    const ownCount = group.tasks.length - group.routineCount
    for (const task of ownTasks(group)) pushWorktree(rows, task, tabsByTask)
    if (group.routineCount > 0) {
      const expanded = input.expandedRoutines?.has(group.key) === true
      rows.push({
        kind: "routines",
        id: routinesRowId(group.key),
        projectKey: group.key,
        count: group.routineCount,
        expanded,
        depth: 1,
      })
      if (expanded) for (const task of group.tasks.slice(ownCount)) pushWorktree(rows, task, tabsByTask)
    }
  }
  return rows
}

/** Grouping pass + row pass. The React sidebar calls them separately because the rail needs groups alone. */
export function buildTreeRows(input: TreeInput): TreeRow[] {
  return buildRowsFromGroups({
    groups: buildSidebarGroups(input),
    tabsByTask: input.tabsByTask,
    expandedRoutines: input.expandedRoutines,
  })
}

function pushWorktree(rows: TreeRow[], task: Task, tabsByTask: ReadonlyMap<string, readonly TreeTab[]>): void {
  rows.push({ kind: "worktree", id: task.id, task, depth: 1 })
  for (const tab of tabsByTask.get(task.id) ?? []) {
    rows.push({ kind: "tab", id: tabRowId(task.id, tab.id), task, tab, depth: 2 })
  }
}

/**
 * The cursor's id list. Project/machine headers are excluded: `enter` would
 * have no session and every per-task chord (d/a/r) would need a header guard.
 */
export function treeFlatIds(rows: readonly TreeRow[]): string[] {
  const ids: string[] = []
  for (const row of rows) {
    // The routines row IS navigable: opening it is its whole point.
    if (row.kind !== "project" && row.kind !== "machine") ids.push(row.id)
  }
  return ids
}

/**
 * A project's `main` task. Project reorder = `moveTask` on it: a project sits
 * where its first task appears in the store, and mains move among mains.
 * Null (reorder is a no-op) when the repo has no main checkout.
 */
export function mainTaskIdOfProject(tasks: readonly Task[], projectKey: string): string | null {
  for (const task of tasks) {
    if (task.kind !== "main") continue
    if (sidebarProjectKeyOfTask(task) === projectKey) return String(task.id)
  }
  return null
}

/**
 * The row wearing each jump digit, in slot order. Digits number TASKS (same
 * slot folded or unfolded); first row per task wins, so a scratch task's
 * first tab row stands for it and no task prints two digits.
 *
 * Walks `rows`, not `eligible`, so a search renumbers down the surviving rows
 * (the fold has no search, so nothing disagrees). `eligible` omits routine
 * sessions, which would push opened tasks past slot 9. The "↩ recent" row is
 * skipped: it's a duplicate of a task and would shift every digit.
 */
export function jumpRowsOf(rows: readonly TreeRow[], eligible: ReadonlySet<string>): string[] {
  const out: string[] = []
  const claimed = new Set<string>()
  for (const row of rows) {
    if (row.kind !== "worktree" && row.kind !== "tab") continue
    const taskId = String(row.task.id)
    if (!eligible.has(taskId) || claimed.has(taskId)) continue
    claimed.add(taskId)
    out.push(row.id)
  }
  return out
}

export { tabRowActivity } from "./tab-row-activity"
