/**
 * Sidebar tree shaping — project → Task → Terminal Tab, as ONE flat row list.
 *
 * There is no horizontal chattab strip: a Task's tabs are child rows under
 * it in the sidebar, and the right side is nothing but the active terminal.
 * This module owns the shape; the renderer owns the glyphs.
 *
 * Why flat rows with a `depth` instead of a nested structure: the entire
 * sidebar navigation model is a cursor over `flatTaskIds` (see
 * `controller.ts`) — j/k/gg/search/ctrl+digit all index into that one array.
 * Emitting tab rows into the SAME array means every one of those behaviours
 * extends to tabs for free, and a tab row is selectable by exactly the
 * mechanism that already selects tasks. A tree of nested arrays would have
 * required a parallel traversal for each.
 *
 * The row id is the navigation key, so it must be unique across both kinds:
 * a task row keys on the task id, a tab row on `${taskId}::${tabId}` — the
 * same composite the PTY registry already uses for tab keys, so the two
 * never disagree about what identifies a tab.
 */

import type { Task } from "@/types/task"
import type { VendorId } from "../../../types/vendor"
import { sidebarProjectKeyOfTask } from "./groups"
import { type SidebarGroup, type SidebarGroupInput, buildSidebarGroups, ownTasks } from "./project-groups"
import { RECENT_ROW_ID, SCRATCH_SECTION_ID, routinesRowId, tabRowId } from "./tree-ids"

// Search lives in its own module — this file decides what rows EXIST, that one
// decides which survive a query — but stays part of tree-core's public surface,
// so every caller imports the tree's vocabulary from one place.
export { filterTreeRows } from "./tree-search"
// The row-id vocabulary and the row-label rule live in their own modules —
// both are read by code that never builds a tree (the PTY registry composes
// the same tab key; the row renderer labels one task at a time). Re-exported
// here so every caller still names them through the tree's vocabulary.
export {
  RECENT_ROW_ID,
  SCRATCH_SECTION_ID,
  machineRowId,
  parseRowId,
  projectKeyOfRoutinesRow,
  tabRowId,
} from "./tree-ids"
export { rowLiveBranchPath, worktreeRowLabel } from "./tree-labels"

/** Selection, grouping and ordering are one shared answer (project-groups.ts)
 *  so the expanded tree and the folded rail can never disagree about which
 *  projects exist. Re-exported here, because callers that only ever name one
 *  task’s project still reach for the tree’s vocabulary. */
export { ownerProjectKey, projectKeysOf } from "./project-groups"

/** A worktree row's tab, as the sidebar needs it (the tab module owns the
 *  real shape; this is the projection the tree renders). */
export interface TreeTab {
  readonly id: string
  /** Already-resolved display name — title ?? liveName ?? … ?? "Tab N".
   *  Resolving precedence is the tab module's job, not the tree's. */
  readonly label: string
  /** The task's ACTIVE tab — the row that carries the session's state glyph
   *  (state lives on the chattab, not the worktree). */
  readonly active?: boolean
  /** A coding-agent tab. Shell/command/content tabs are outside the state
   *  vocabulary entirely — they always wear the plain dot. */
  readonly engine?: boolean
  /** Which engine is running in this tab RIGHT NOW, walked from the pty
   *  child's process tree (`liveEngines.resolve`), falling back to the tab's
   *  recorded identity when the probe cannot answer. This is an observation,
   *  not configuration: it says what the process IS, which is why the row can
   *  show it for every agent tab instead of only the ones someone pinned a
   *  model on. `null`/absent = not an engine, or nothing answered. */
  readonly liveVendor?: VendorId | null
  /** The pty host holds this tab as a FREEZE-RESTORED corpse: scrollback
   *  kept, process gone, and the next open respawns its recorded launch
   *  command. Distinct from a quiet tab, which is what it otherwise looks
   *  like. */
  readonly restored?: boolean
}

export type TreeRow =
  /**
   * A MACHINE section header — another computer running its own Rove daemon.
   * Emitted only when at least one machine is registered; with none, the tree
   * has no machine rows at all and every depth below is what it always was.
   */
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
   * The routine count row: one row standing in for a project's
   * routine session tasks, which are background noise beside the handful of
   * tasks the user opened themselves — 7 daily routines are 49 rows a week.
   * Opening it reveals those tasks; they are never removed from the data.
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

/** What a machine row says about its connection. `mismatch` is a remote Rove
 *  whose protocol range this build cannot talk to — its own row's problem,
 *  never the whole tree's. */
export type MachineRowState = "connecting" | "online" | "offline" | "unsupported" | "mismatch"

/**
 * Prepend the "↩ recent: <task>" jump row (narrow mode only — the caller
 * gates). The row names the last task the user was INSIDE, so a cold
 * reconnect (phone SSH) gets a one-keystroke way back into it.
 */
export function withRecentRow(rows: readonly TreeRow[], recent: Task | null): TreeRow[] {
  if (!recent) return [...rows]
  return [{ kind: "recent", id: RECENT_ROW_ID, task: recent, depth: 1 }, ...rows]
}

export interface TreeInput extends SidebarGroupInput {
  /** Tabs per task id. A task absent from the map contributes no tab rows —
   *  its tabs have never mounted, which is not the same as having none. */
  readonly tabsByTask: ReadonlyMap<string, readonly TreeTab[]>
  /** Project keys whose routine count row is open. Absent = all
   *  closed, which is the resting state a fresh session starts in. */
  readonly expandedRoutines?: ReadonlySet<string>
}

export interface TreeRowsInput {
  /** The sections to render, already selected, grouped and ordered. */
  readonly groups: readonly SidebarGroup[]
  readonly tabsByTask: ReadonlyMap<string, readonly TreeTab[]>
  readonly expandedRoutines?: ReadonlySet<string>
}

/**
 * Turn the sidebar's sections into the flat row list.
 *
 * This is PRESENTATION only. Which tasks exist, which project each belongs to
 * and what order they sit in were all decided by `buildSidebarGroups`, and the
 * folded rail reads those same groups — so the two surfaces cannot draw
 * different boundaries or hide different projects. What this function adds is
 * the tree's own vocabulary: a header row per section, a worktree row per
 * task, a tab row per tab, and the routine fold.
 *
 * A `main` task renders as the first worktree row under its project rather
 * than as the project row itself: the project row is a pure grouping header (a
 * repo, not a checkout), which is what lets "main" carry tabs like any other
 * worktree.
 */
export function buildRowsFromGroups(input: TreeRowsInput): TreeRow[] {
  const { tabsByTask } = input
  const rows: TreeRow[] = []
  for (const group of input.groups) {
    // The scratch header reuses the project-row shape (its id is a sentinel no
    // repo path can be — see SCRATCH_SECTION_ID); the renderer translates the
    // label.
    rows.push({
      kind: "project",
      id: group.key,
      repo: group.repo,
      label: group.label,
      machineId: group.machineId,
      depth: 0,
    })
    if (group.key === SCRATCH_SECTION_ID) {
      // A scratch task renders NO worktree row of its own: its auto-generated
      // name is noise, and the shell IS the whole session — so its tab rows
      // hang directly under the section header. The task remains a real task
      // in the data layer; only the render skips its middle row. When its tabs
      // are unknown (never mounted since restart) the worktree row stays as
      // the only reachable handle — a task with zero rows would be invisible
      // AND unnavigable.
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
    // Routine sessions are already the TAIL of `group.tasks`; the count row is
    // the seam between the two halves.
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
      // Opened, the folded tasks render as ordinary worktree rows — the fold
      // hides them at rest, it does not make them a different kind of thing.
      if (expanded) for (const task of group.tasks.slice(ownCount)) pushWorktree(rows, task, tabsByTask)
    }
  }
  return rows
}

/**
 * Tasks → rows, in one call: the grouping pass followed by the row pass.
 *
 * The React sidebar splits these, because the folded rail needs the groups
 * without the rows. Everything else — and every test that asks "what does this
 * task list look like" — wants both, and going through this composition is
 * what guarantees it sees the same grouping the rail does.
 */
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
 * The navigable id list — what the cursor indexes into.
 *
 * Project rows are EXCLUDED: they are grouping headers, and letting the
 * cursor rest on one would mean `enter` has no session to open and every
 * per-task chord (d/a/r) would need a "not on a header" guard. Collapsing a
 * project is a mouse click or a chord from one of its worktrees, not a
 * cursor position.
 */
export function treeFlatIds(rows: readonly TreeRow[]): string[] {
  const ids: string[] = []
  for (const row of rows) {
    // The routines count row IS navigable, unlike a project header: opening
    // it is the whole point, so the cursor has to be able to land on it.
    if (row.kind !== "project" && row.kind !== "machine") ids.push(row.id)
  }
  return ids
}

/**
 * The `main` task of a project — the repo's own checkout.
 *
 * This is how the tree REORDERS projects, and it needs no new persistence:
 * a project's position is where its first task appears in the store, and
 * `moveTask` on a `main` row already swaps it past the neighbouring project's
 * `main` (mains move among mains). So moving the main task IS moving the
 * project, and one existing daemon call covers it.
 *
 * Null when the project has no main checkout — a repo that only ever produced
 * task worktrees has no row to move, so project reorder is a no-op there.
 */
export function mainTaskIdOfProject(tasks: readonly Task[], projectKey: string): string | null {
  for (const task of tasks) {
    if (task.kind !== "main") continue
    if (sidebarProjectKeyOfTask(task) === projectKey) return String(task.id)
  }
  return null
}

/**
 * The row that WEARS each jump digit, in slot order.
 *
 * The digit numbers TASKS — `jumpTaskIds` over the groups both sidebar
 * surfaces share — so that a slot means the same session folded or unfolded.
 * This maps those tasks onto the row the tree prints the number on, which is
 * not always the obvious one: a scratch session hangs its tabs straight under
 * the section header and has no worktree row, so its FIRST TAB row stands for
 * it. First row per task wins, so no task prints two digits.
 *
 * Walking `rows` rather than `eligible` is what keeps SEARCH working. A query
 * prunes the tree, and the digits have to renumber down the rows that
 * survived — you read the number off the row, you do not remember it. The
 * fold has no search, so there is no second surface to disagree with while a
 * query is open; at rest the two lists are identical again.
 *
 * `eligible` is the task set that may carry a digit at all — routine sessions
 * are left out of it, because there are as many of them as their schedule has
 * fired and they would push the tasks a person opened past the ninth slot, the
 * last one with a digit. The "↩ recent" row is skipped for a related reason:
 * it is a second appearance of a task that already has a row, and letting it
 * take slot one shifted every other digit in narrow mode.
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

// Tab-row activity resolution lives in its own module: it answers which of the
// daemon's two activity levels speaks for a row, which is not a question about
// rows existing and needs none of this file's shapes. Re-exported here so
// callers still name it through the tree's vocabulary.
export { tabRowActivity } from "./tab-row-activity"
