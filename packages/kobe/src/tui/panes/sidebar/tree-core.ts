/**
 * Sidebar tree shaping — project → Task → Terminal Tab, as ONE flat row list.
 *
 * The owner's call (2026-08-01) retires the horizontal chattab strip: a
 * a Task's tabs become child rows under it in the sidebar, and the right
 * side is nothing but the active terminal. This module owns the shape; the
 * renderer owns the glyphs.
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

import { homedir } from "node:os"
import type { Task } from "@/types/task"
import { truncateStart } from "../../lib/truncate"
import { fuzzyMatch } from "./fuzzy"
import { compareRecent, repoBasename, sidebarProjectKey, sidebarProjectLabel } from "./groups"

// Search lives in its own module — this file decides what rows EXIST, that one
// decides which survive a query — but stays part of tree-core's public surface,
// so every caller imports the tree's vocabulary from one place.
export { filterTreeRows } from "./tree-search"

/** Separator between a task id and a tab id in a tab row's id. Matches the
 *  PTY registry's key format so one parse rule covers both. */
export const TAB_ROW_SEPARATOR = "::"

/** A worktree row's tab, as the sidebar needs it (the tab module owns the
 *  real shape; this is the projection the tree renders). */
export interface TreeTab {
  readonly id: string
  /** Already-resolved display name — title ?? liveName ?? … ?? "Tab N".
   *  Resolving precedence is the tab module's job, not the tree's. */
  readonly label: string
  /** The task's ACTIVE tab — the row that carries the session's state glyph
   *  (owner call 2026-08-01: state lives on the chattab, not the worktree). */
  readonly active?: boolean
  /** A coding-agent tab. Shell/command/content tabs are outside the state
   *  vocabulary entirely — they always wear the plain dot. */
  readonly engine?: boolean
}

export type TreeRow =
  | { readonly kind: "project"; readonly id: string; readonly repo: string; readonly label: string; readonly depth: 0 }
  | { readonly kind: "worktree"; readonly id: string; readonly task: Task; readonly depth: 1 }
  | {
      readonly kind: "tab"
      readonly id: string
      readonly task: Task
      readonly tab: TreeTab
      readonly depth: 2
    }
  | { readonly kind: "recent"; readonly id: typeof RECENT_ROW_ID; readonly task: Task; readonly depth: 1 }
  /**
   * The routine count row (issue #91): one row standing in for a project's
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
      readonly depth: 1
    }

/**
 * Navigation id of the narrow-mode "↩ recent" jump row (issue #14, 2A).
 * Not a ULID and free of {@link TAB_ROW_SEPARATOR}, so `parseRowId` on it
 * yields a task id no task can have — cursor chords that don't special-case
 * it fall through to a lookup miss instead of acting on a real task.
 */
export const RECENT_ROW_ID = "~recent"

/**
 * Header id of the Scratch section (issue #33). Like {@link RECENT_ROW_ID},
 * not a repo path and free of the separator, so project-header consumers
 * (move mode, context menu, `mainTaskIdOfProject`) that look it up simply
 * miss — a Scratch header has no main task to move and no repo to file into.
 */
export const SCRATCH_SECTION_ID = "~scratch"

/**
 * Navigation id of a project's routine count row (issue #91). Prefixed like
 * the other sentinels so it can never collide with a ULID, and carrying the
 * project key so two projects' rows stay distinct.
 *
 * This row is the ONE fold in a tree that otherwise has none (owner call
 * 2026-08-01, round 5 — see `tree-panel.tsx`). It is scoped deliberately: it
 * folds only tasks a SCHEDULE created, never a task a human opened, so the
 * "everything under a project is always visible" promise still holds for
 * everything the user made themselves.
 */
export function routinesRowId(projectKey: string): string {
  return `~routines:${projectKey}`
}

/** The project key a routines row id names, or null for any other id. */
export function projectKeyOfRoutinesRow(id: string): string | null {
  return id.startsWith("~routines:") ? id.slice("~routines:".length) : null
}

/** True for a task the sidebar folds behind a routine count row. */
export function isRoutineTask(task: Task): boolean {
  return task.routine !== undefined
}

/**
 * Prepend the "↩ recent: <task>" jump row (narrow mode only — the caller
 * gates). The row names the last task the user was INSIDE, so a cold
 * reconnect (phone SSH) gets a one-keystroke way back into it.
 */
export function withRecentRow(rows: readonly TreeRow[], recent: Task | null): TreeRow[] {
  if (!recent) return [...rows]
  return [{ kind: "recent", id: RECENT_ROW_ID, task: recent, depth: 1 }, ...rows]
}

/** Compose a tab row's navigation id. */
export function tabRowId(taskId: string, tabId: string): string {
  return `${taskId}${TAB_ROW_SEPARATOR}${tabId}`
}

/**
 * Split a row id back into its parts. A task row id has no separator and
 * yields `tabId: null` — callers switch on that rather than string-matching
 * the separator themselves.
 *
 * Task ids are ULIDs and tab ids are `tab-N`, so neither contains the
 * separator; splitting on the FIRST occurrence is unambiguous either way.
 */
export function parseRowId(rowId: string): { taskId: string; tabId: string | null } {
  const at = rowId.indexOf(TAB_ROW_SEPARATOR)
  if (at < 0) return { taskId: rowId, tabId: null }
  return { taskId: rowId.slice(0, at), tabId: rowId.slice(at + TAB_ROW_SEPARATOR.length) }
}

/** Widest path label a worktree row renders before tail-truncation — the
 *  default rail width minus row chrome. The row's flex still end-clips on
 *  narrower rails; pre-truncating from the START keeps the leaf visible at
 *  the default width, which is the half that disambiguates a path. */
export const PATH_LABEL_MAX = 24

/**
 * What a worktree row is CALLED — the one derivation rule (issue #42):
 * a task with a branch is named by it; a branchless `dir` task (plain
 * `rove .` opens and scratch shells alike) by its tail-truncated
 * directory — the stored title is deliberately ignored there, because
 * dir-task titles are auto-generated noise (`jacksonc-xxxx`) and legacy
 * rows render by the new rule with no data migration. A regular task
 * before its worktree materialises (no branch yet, path not its own)
 * keeps its title, else the label falls back to the path and finally
 * "scratch" so a row is never blank.
 *
 * `liveBranch` is the caller-resolved HEAD for the rows that own no branch of
 * their own (see {@link rowLiveBranchPath} and `git-head.ts`); `home` is
 * injectable so the tildification unit-tests without the real $HOME.
 */
/**
 * The checkout whose LIVE HEAD names this row, or `""` when the row already
 * carries its own branch.
 *
 * Rove-created worktrees store `branch`, so their label is fixed. Two kinds
 * store none and move freely: `main` (its checkout is the user's to switch)
 * and `dir` — an arbitrary directory the user opened, which is what a scratch
 * shell becomes. A scratch shell opened inside a repo IS on a branch, so
 * labelling it with its path while every worktree row beside it showed a
 * branch made it read as a different species of row. Not-a-repo still falls
 * back to the path: the poller answers `""` for anything it can't resolve.
 */
export function rowLiveBranchPath(task: Task): string {
  if (task.kind !== "main" && task.kind !== "dir") return ""
  return task.worktreePath || task.repo || ""
}

export function worktreeRowLabel(
  task: Task,
  opts: { readonly liveBranch?: string; readonly home?: string } = {},
): string {
  const branch = (opts.liveBranch ?? task.branch) || task.branch
  if (branch) return branch
  if (task.kind !== "dir" && task.title) return task.title
  const path = task.worktreePath || task.repo
  if (path) {
    const home = opts.home ?? homedir()
    const tildified = home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path
    return truncateStart(tildified, PATH_LABEL_MAX)
  }
  return task.title || "scratch"
}

export interface TreeInput {
  readonly tasks: readonly Task[]
  /** Tabs per task id. A task absent from the map contributes no tab rows —
   *  its tabs have never mounted, which is not the same as having none. */
  readonly tabsByTask: ReadonlyMap<string, readonly TreeTab[]>
  /** Task sort applied within each project group. Defaults to input order. */
  readonly sortMode?: import("./groups").TaskSortMode
  /** Project keys whose routine count row is open (issue #91). Absent = all
   *  closed, which is the resting state a fresh session starts in. */
  readonly expandedRoutines?: ReadonlySet<string>
}

/**
 * A project you closed down to nothing: its ONLY row is the repo's main
 * checkout (or a directory you opened), and that row's last tab is closed.
 *
 * Such a project is hidden from the tree (owner call 2026-08-31). Nothing is
 * deleted — the main task and the `savedRepos` entry both stay.
 *
 * The way BACK is the new-task dialog's Existing tab: pick the repo and
 * choose "the project itself" instead of a new task worktree, which submits
 * `mode: "open"` and routes to `ensureMainTask` (issue #90). That choice
 * renders only for a repo that already has a main row — which is exactly the
 * set of repos this rule can hide. Until it existed the promise made here was
 * false: every submit path went through `createTask`, which always mints a
 * `kind: "task"`, so picking a hidden repo added a worktree beside the
 * project and still left no project row.
 *
 * This is the whole difference from Forget (`d` on the row →
 * `forgetProject`), which un-saves the repo: closing the last tab is a "I'm
 * done here for now" gesture, not a "remove this from my machine" one.
 *
 * A `dir` row folds the same way (owner call 2026-09-01). It has no
 * picker entry to return through and does not need one: the way back is the
 * `rove .` that opened it in the first place, and a directory was never in
 * `savedRepos` to be lost from. Excluding it only made "close the last tab"
 * mean two different things depending on a row kind the user never chose —
 * the sidebar shows a folder and a checkout as the same shape of row.
 *
 * Deliberately narrow. It requires:
 *   - exactly one task in the project, and that task is a `main` or `dir`
 *     row — anything else is real work with a branch behind it, and
 *   - its tabs are KNOWN and empty — an absent entry means "never mounted
 *     since restart", which is every project on a fresh TUI. Hiding on that
 *     would make the sidebar boot empty.
 *
 * A project with any worktree task under it always renders, even with every
 * tab closed: those rows are how you get back to that work.
 */
function isClosedDownProject(tasks: readonly Task[], tabsByTask: TreeInput["tabsByTask"]): boolean {
  const only = tasks.length === 1 ? tasks[0] : undefined
  if (!only || (only.kind !== "main" && only.kind !== "dir")) return false
  return tabsByTask.get(only.id)?.length === 0
}

/**
 * Build the flat tree rows.
 *
 * Ordering: projects follow their MAIN task's stored order (the same rule the
 * flat sidebar's PROJECTS section renders, and the same partition `moveTask`
 * reorders — so project move-mode visibly moves the header). A project's
 * first-seen regular task must NOT set its position: mains and regular tasks
 * interleave in tasks.json creation order, so keying on any-task order made
 * a main swap read as a no-op. Projects without a main (nothing to move)
 * append after, in first-seen order. Each project is followed by its own
 * worktrees, each followed by its own tabs.
 *
 * A `main` task IS the project's main worktree, so it renders as the first
 * worktree row under its project rather than as the project row itself: the
 * project row is a pure grouping header (a repo, not a checkout), which is
 * what lets "main" carry tabs like any other worktree.
 *
 * `dir` tasks (`kobe .` on an arbitrary directory) group under THEIR
 * DIRECTORY as the project header (owner 2026-08-02) — their `repo` IS the
 * directory, so the grouping rule is the same one every task uses. Emitting
 * them loose after the last project made them read as that project's rows.
 */
export function buildTreeRows(input: TreeInput): TreeRow[] {
  const { tasks, tabsByTask } = input
  const sortMode = input.sortMode ?? "default"
  const byProject = new Map<string, { repo: string; tasks: Task[] }>()

  // Scratch tasks (issue #33) never mint a project header: their cwd is
  // unsettled by definition, so grouping them under their (temporary)
  // directory would name a home they don't have. They render in one
  // Scratch section ABOVE every project — the "unfiled live sessions" bench.
  const scratchTasks = tasks.filter((task) => task.kind === "dir" && task.scratch === true)
  if (sortMode === "recent") scratchTasks.sort(compareRecent)

  for (const task of tasks) {
    if (task.kind === "dir" && task.scratch === true) continue
    const key = sidebarProjectKey(task.repo)
    const entry = byProject.get(key) ?? { repo: task.repo, tasks: [] }
    // The main task carries the canonical repo path — a regular task's
    // `repo` is the same value, but taking it from main keeps the header
    // label stable if they ever disagree.
    if (task.kind === "main") {
      entry.repo = task.repo
      entry.tasks.unshift(task)
    } else {
      entry.tasks.push(task)
    }
    byProject.set(key, entry)
  }

  // Project order = the mains' stored order (the partition moveTask swaps),
  // then main-less projects in first-seen order. Keying on first-seen ANY
  // task made project move-mode a no-op whenever an older regular task
  // anchored the group ahead of its main.
  const orderedKeys: string[] = []
  const seen = new Set<string>()
  for (const task of tasks) {
    if (task.kind !== "main") continue
    const key = sidebarProjectKey(task.repo)
    if (!seen.has(key)) {
      seen.add(key)
      orderedKeys.push(key)
    }
  }
  for (const key of byProject.keys()) {
    if (!seen.has(key)) {
      seen.add(key)
      orderedKeys.push(key)
    }
  }

  if (sortMode === "recent") {
    for (const entry of byProject.values()) {
      entry.tasks.sort((a, b) => {
        // Keep the repo's main checkout as the first worktree row under its
        // project header; only the regular worktrees reorder by recency.
        if (a.kind === "main" && b.kind !== "main") return -1
        if (b.kind === "main" && a.kind !== "main") return 1
        return compareRecent(a, b)
      })
    }
  }

  const rows: TreeRow[] = []
  // Scratch section first — above pinned and every project (issue #33): the
  // bench of unfiled live shells is what you reach for next.
  // The header reuses the project-row shape (id is a sentinel no repo path
  // can be — see SCRATCH_SECTION_ID); the renderer translates its label.
  if (scratchTasks.length > 0) {
    rows.push({ kind: "project", id: SCRATCH_SECTION_ID, repo: "", label: "Scratch", depth: 0 })
    // A scratch task renders NO worktree row of its own (issue #41): its
    // auto-generated name is noise, and the shell IS the whole session — so
    // its tab rows hang directly under the section header. The task remains a
    // real task in the data layer (#472's migration machinery is untouched);
    // only the render skips its middle row. When its tabs are unknown (never
    // mounted since restart) the worktree row stays as the only reachable
    // handle — a task with zero rows would be invisible AND unnavigable.
    for (const task of scratchTasks) {
      const tabs = tabsByTask.get(task.id) ?? []
      if (tabs.length === 0) {
        rows.push({ kind: "worktree", id: task.id, task, depth: 1 })
        continue
      }
      for (const tab of tabs) {
        rows.push({ kind: "tab", id: tabRowId(task.id, tab.id), task, tab, depth: 2 })
      }
    }
  }
  // Header labels disambiguate against EVERY other project on screen, not
  // just against themselves: with 5 repos open, `~/work/api` and `~/oss/api`
  // both rendered the bare basename `api`, so two headers read as one repo
  // while the toast that had just named one of them said `work/api`. Same
  // helper every other surface already uses (Inbox, Kanban, work items,
  // automations) — the tree was the last holdout.
  // Projects closed down to nothing drop out of the tree entirely — header
  // and row (see `isClosedDownProject`). Computed BEFORE the label pass so a
  // hidden project can't influence how the visible ones disambiguate.
  const visibleKeys = orderedKeys.filter((key) => {
    const entry = byProject.get(key)
    return entry ? !isClosedDownProject(entry.tasks, tabsByTask) : false
  })
  const projectRepos = visibleKeys.map((key) => byProject.get(key)?.repo ?? "")
  for (const key of visibleKeys) {
    const entry = byProject.get(key)
    if (!entry) continue
    rows.push({
      kind: "project",
      id: key,
      repo: entry.repo,
      label: sidebarProjectLabel(entry.repo, projectRepos),
      depth: 0,
    })
    // Routine sessions (issue #91) sort to the END of their project, behind
    // one count row: they are a schedule's output, so they must never push
    // the tasks the user opened themselves down the pane.
    const routineTasks = entry.tasks.filter(isRoutineTask)
    for (const task of entry.tasks) {
      if (!isRoutineTask(task)) pushWorktree(rows, task, tabsByTask)
    }
    if (routineTasks.length > 0) {
      const expanded = input.expandedRoutines?.has(key) === true
      rows.push({
        kind: "routines",
        id: routinesRowId(key),
        projectKey: key,
        count: routineTasks.length,
        expanded,
        depth: 1,
      })
      // Opened, the folded tasks render as ordinary worktree rows — the fold
      // hides them at rest, it does not make them a different kind of thing.
      if (expanded) for (const task of routineTasks) pushWorktree(rows, task, tabsByTask)
    }
  }
  return rows
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
    if (row.kind !== "project") ids.push(row.id)
  }
  return ids
}

/** The project a row belongs to — exported for `tree-search`, which prunes
 *  by the same grouping the tree builds with. A `dir` task's project is its
 *  directory. A `dir` task's project is its directory —
 *  the same key `buildTreeRows` groups it under. */
export function ownerProjectKey(task: Task): string | null {
  if (task.kind === "dir" && task.scratch === true) return SCRATCH_SECTION_ID
  return sidebarProjectKey(task.repo)
}

/**
 * Every project key, in the same first-seen order `buildTreeRows` emits its
 * project headers — what "focus one project" needs in order to know which
 * others to fold.
 */
export function projectKeysOf(tasks: readonly Task[]): string[] {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const task of tasks) {
    const key = ownerProjectKey(task)
    if (key === null || seen.has(key)) continue
    seen.add(key)
    keys.push(key)
  }
  return keys
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
    if (sidebarProjectKey(task.repo) === projectKey) return String(task.id)
  }
  return null
}

// Tab-row activity resolution lives in its own module: it answers which of the
// daemon's two activity levels speaks for a row, which is not a question about
// rows existing and needs none of this file's shapes. Re-exported here so
// callers still name it through the tree's vocabulary.
export { tabRowActivity } from "./tab-row-activity"
