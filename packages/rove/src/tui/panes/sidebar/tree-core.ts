/**
 * Sidebar tree shaping — project → Task → child Tasks, as ONE flat row list
 * with `depth`. This module owns the shape; the renderer owns the glyphs.
 *
 * Flat because navigation is one cursor over `flatTaskIds` (`controller.ts`):
 * j/k/gg/search/ctrl+digit walk children with no parallel traversal.
 *
 * A Task is one conversation, so tabs are never rows. Row ids are task ids
 * (or a sentinel); a tab's `${taskId}::${tabId}` composite names a PTY, not a row.
 */

import { isSharedChild } from "@/orchestrator/task-tree"
import type { Task } from "@/types/task"
import type { VendorId } from "../../../types/vendor"
import { sidebarProjectKeyOfTask } from "./groups"
import { type SidebarGroup, type SidebarGroupInput, buildSidebarGroups, ownTasks } from "./project-groups"
import { RECENT_ROW_ID, routinesRowId } from "./tree-ids"

// Re-exported so callers name the whole tree vocabulary from one module.
export { filterTreeRows } from "./tree-search"
export {
  RECENT_ROW_ID,
  SCRATCH_SECTION_ID,
  parseRowId,
  projectKeyOfRoutinesRow,
  tabRowId,
} from "./tree-ids"
export { conversationTitleOf, rowLiveBranchPath, worktreeRowLabel } from "./tree-labels"

/** One shared grouping (project-groups.ts), so tree and folded rail agree on which projects exist. */
export { ownerProjectKey, projectKeysOf } from "./project-groups"

/** The tree's projection of a tab (the tab module owns the real shape). */
export interface TreeTab {
  readonly id: string
  /** Already-resolved display name; precedence is the tab module's job. */
  readonly label: string
  /** What the engine conversation is called, when it has a name (`conversationTitle`); absent = unnamed. */
  readonly title?: string
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
}

/**
 * Where a row from ANOTHER machine lives, stamped by the machine layer
 * (`machine-layer.ts`): the row wears a cloud mark, toned by `state`.
 */
export interface RemoteMark {
  /** Remote hostname when known, else the alias. */
  readonly host: string
  readonly state: MachineRowState
  readonly version?: string
}

export type TreeRow =
  | {
      readonly kind: "project"
      readonly id: string
      readonly repo: string
      readonly label: string
      /** The home checkout's machine (what the header's actions act on); `"local"` for this computer. */
      readonly machineId: string
      readonly depth: number
    }
  | {
      readonly kind: "worktree"
      readonly id: string
      readonly task: Task
      /** Indent level: 1 for a top-level task, +1 per generation, held at {@link MAX_TREE_DEPTH}. */
      readonly depth: number
      /** The real generation (4+) of a row deeper than the indent cap; absent while the indent still tells. */
      readonly level?: number
      /** Set on a task with children. */
      readonly fold?: TreeFold
      /** The engine conversation's own name, when it has one; the label prefers it. */
      readonly title?: string
      /** Set when the task lives on another machine. */
      readonly remote?: RemoteMark
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
      /** The routine sessions behind the row, so a closed fold can still flag one that needs you. */
      readonly tasks: readonly Task[]
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

/** Indent stops growing here; a deeper row keeps this depth and wears its real level. */
export const MAX_TREE_DEPTH = 3

/** What a task row says about its children. */
export interface TreeFold {
  /** Every descendant, not just direct children: what a closed fold hides. */
  readonly count: number
  readonly collapsed: boolean
  /** Their ids, so a closed fold can still surface the most urgent one. */
  readonly descendantIds: readonly string[]
}

/** `shared` = runs in its owner's directory, `worktree` = its own checkout. */
export type ChildMarker = "shared" | "worktree"

/** Null for a task that was never anyone's child. */
export function childMarkerOf(task: Task): ChildMarker | null {
  if (task.parentTaskId === undefined) return null
  return isSharedChild(task) ? "shared" : "worktree"
}

export interface TreeInput extends SidebarGroupInput {
  /** Project keys whose routine row is open; absent = all closed. */
  readonly expandedRoutines?: ReadonlySet<string>
  /** Task ids whose children are folded away; absent = all open. */
  readonly collapsedTasks?: ReadonlySet<string>
  /** taskId → its conversation's name (`conversationTitleOf`); absent = unnamed. */
  readonly conversationTitles?: ReadonlyMap<string, string>
}

export interface TreeRowsInput {
  /** The sections to render, already selected, grouped and ordered. */
  readonly groups: readonly SidebarGroup[]
  readonly expandedRoutines?: ReadonlySet<string>
  readonly collapsedTasks?: ReadonlySet<string>
  /** taskId → its conversation's name (`conversationTitleOf`); absent = unnamed. */
  readonly conversationTitles?: ReadonlyMap<string, string>
}

interface ChildIndex {
  readonly children: ReadonlyMap<string, readonly Task[]>
  readonly nested: ReadonlySet<string>
}

/** True when `task`'s parent chain comes back to `task`. */
function loopsBack(task: Task, byId: ReadonlyMap<string, Task>): boolean {
  const seen = new Set<string>([task.id])
  for (let at = task.parentTaskId; at !== undefined; at = byId.get(at)?.parentTaskId) {
    if (seen.has(at)) return at === task.id
    seen.add(at)
  }
  return false
}

/**
 * Children nest under their parent wherever it sits, another project's
 * included. One whose parent is not on screen (or whose lineage loops) stays
 * top-level; routine sessions stay in their fold. Children keep list order.
 */
function indexChildren(groups: readonly SidebarGroup[]): ChildIndex {
  const byId = new Map<string, Task>()
  for (const group of groups) for (const task of group.tasks) byId.set(task.id, task)
  const children = new Map<string, Task[]>()
  const nested = new Set<string>()
  for (const task of byId.values()) {
    const parent = task.parentTaskId
    if (parent === undefined || task.routine !== undefined || !byId.has(parent) || loopsBack(task, byId)) continue
    nested.add(task.id)
    const siblings = children.get(parent)
    if (siblings) siblings.push(task)
    else children.set(parent, [task])
  }
  return { children, nested }
}

function descendantIds(children: ChildIndex["children"], id: string, out: string[] = []): string[] {
  for (const child of children.get(id) ?? []) {
    out.push(child.id)
    descendantIds(children, child.id, out)
  }
  return out
}

interface PushContext extends ChildIndex {
  readonly collapsed: ReadonlySet<string> | undefined
  readonly titles: ReadonlyMap<string, string> | undefined
}

/** A task's row, then its children's (unless folded), one indent level deeper each. */
function pushTask(rows: TreeRow[], task: Task, generation: number, ctx: PushContext): void {
  const kids = ctx.children.get(task.id)
  const collapsed = kids !== undefined && ctx.collapsed?.has(task.id) === true
  const level = generation + 1
  const title = ctx.titles?.get(task.id)
  const ids = kids ? descendantIds(ctx.children, task.id) : []
  rows.push({
    kind: "worktree",
    id: task.id,
    task,
    depth: Math.min(level, MAX_TREE_DEPTH),
    ...(level > MAX_TREE_DEPTH ? { level } : {}),
    ...(kids ? { fold: { count: ids.length, collapsed, descendantIds: ids } } : {}),
    ...(title ? { title } : {}),
  })
  if (collapsed || !kids) return
  for (const child of kids) pushTask(rows, child, generation + 1, ctx)
}

/**
 * Sections → flat rows. Presentation only: membership and order come from
 * `buildSidebarGroups`, which the folded rail also reads.
 *
 * A `main` task is the first worktree row under its project, not the project
 * row: the header is a repo, not a checkout, so main can carry children.
 */
export function buildRowsFromGroups(input: TreeRowsInput): TreeRow[] {
  const ctx: PushContext = {
    ...indexChildren(input.groups),
    collapsed: input.collapsedTasks,
    titles: input.conversationTitles,
  }
  const rows: TreeRow[] = []
  for (const group of input.groups) {
    // Routine sessions are the TAIL of `group.tasks`; the count row sits at the seam.
    const ownCount = group.tasks.length - group.routineCount
    const top = ownTasks(group).filter((task) => !ctx.nested.has(task.id))
    // Every task here hangs under a parent elsewhere: a bare header would read as an empty project.
    if (top.length === 0 && group.routineCount === 0) continue
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
    for (const task of top) pushTask(rows, task, 0, ctx)
    if (group.routineCount > 0) {
      const expanded = input.expandedRoutines?.has(group.key) === true
      const routines = group.tasks.slice(ownCount)
      rows.push({
        kind: "routines",
        id: routinesRowId(group.key),
        projectKey: group.key,
        count: group.routineCount,
        tasks: routines,
        expanded,
        depth: 1,
      })
      if (expanded) for (const task of routines) pushTask(rows, task, 0, ctx)
    }
  }
  return rows
}

/** Grouping pass + row pass. The React sidebar calls them separately because the rail needs groups alone. */
export function buildTreeRows(input: TreeInput): TreeRow[] {
  return buildRowsFromGroups({
    groups: buildSidebarGroups(input),
    expandedRoutines: input.expandedRoutines,
    collapsedTasks: input.collapsedTasks,
    conversationTitles: input.conversationTitles,
  })
}

/**
 * The cursor's id list. Project headers are excluded: `enter` would have no
 * session and every per-task chord (d/a/r) would need a header guard.
 */
export function treeFlatIds(rows: readonly TreeRow[]): string[] {
  const ids: string[] = []
  for (const row of rows) {
    // The routines row IS navigable: opening it is its whole point.
    if (row.kind !== "project") ids.push(row.id)
  }
  return ids
}

/**
 * A project's `main` task. Project reorder = `moveTask` on it: a project sits
 * where its first task appears in the store, and mains move among mains.
 * Null (reorder is a no-op) when the repo has no main checkout.
 */
export function mainTaskIdOfProject(tasks: readonly Task[], projectKey: string): string | null {
  // A merged project's key is its HOME checkout's, so only the home main
  // answers: another machine's main of the same repo is not this header's to
  // reorder or forget.
  for (const task of tasks) {
    if (task.kind !== "main") continue
    if (sidebarProjectKeyOfTask(task) === projectKey) return String(task.id)
  }
  return null
}

export { tabRowActivity } from "./tab-row-activity"
