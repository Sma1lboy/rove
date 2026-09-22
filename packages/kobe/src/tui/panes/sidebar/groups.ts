/**
 * Pure list-shaping helpers for the sidebar pane. Selected-task repo/branch
 * metadata lives in the topbar, not here.
 *
 * {@link buildRows} emits one flat ordered list (no per-project nesting);
 * the renderer draws it as two sections, PROJECTS (`main` rows) then TASKS.
 * Because every `main` row precedes every task row, the divider sits at the
 * first non-main index.
 */

import { reconcileStableRows } from "@/tui/lib/stable-rows"
import type { Task } from "@/types/task"
import { pathIdentity, pathSyntax } from "@sma1lboy/kobe-daemon/path-identity"
import { fuzzyMatch } from "./fuzzy"

/**
 * `attention` ranks by derived task group (what needs a person next). Its
 * comparator (`compareTaskGroup`) lives in `task-group-view.ts`, which
 * imports this module, so it can't live here.
 */
export type TaskSortMode = "default" | "recent" | "attention"

/** One visible sidebar row; kept a discriminated union so new row kinds slot in. */
export type SidebarRow = { kind: "task"; task: Task; flatIndex: number }
export type SidebarProjectOption = { repo: string; label: string; count: number }
export type SidebarRowSections = {
  projectRows: SidebarRow[]
  taskRows: SidebarRow[]
}

/**
 * Flat row list; `flatIndex` is the row's position in the navigable id list.
 *
 * Order: `main` rows (stored order, one per repo), then `pinned` tasks, then
 * the rest — a stable partition, not a sort, because regular-task order is
 * the orchestrator's (ULID/createdAt) and a sort would scramble it.
 *
 * `searchQuery`: case-insensitive subsequence filter over
 * `title + " " + basename(repo)`, applied before partitioning.
 * `projectFilter` scopes BOTH sections: the filter label sits on the PROJECTS
 * header, so out-of-scope main rows hide too.
 */
export function buildRows(
  tasks: readonly Task[],
  searchQuery?: string,
  sortMode: TaskSortMode = "default",
  projectFilter?: string | null,
): SidebarRow[] {
  const q = searchQuery?.trim() ?? ""
  const projectKey = projectFilter ? sidebarProjectKey(projectFilter) : null
  const filtered = q ? tasks.filter((t) => fuzzyMatch(q, `${t.title} ${repoBasename(t.repo)}`)) : tasks
  const main: Task[] = []
  const pinnedRegular: Task[] = []
  const regular: Task[] = []
  const seenMainRepos = new Set<string>()
  for (const t of filtered) {
    if (t.kind === "main") {
      const key = sidebarProjectKey(t.repo)
      if (projectKey && key !== projectKey) continue
      if (seenMainRepos.has(key)) continue
      seenMainRepos.add(key)
      main.push(t)
      continue
    }
    if (projectKey && sidebarProjectKey(t.repo) !== projectKey) continue
    if (t.pinned === true) pinnedRegular.push(t)
    else regular.push(t)
  }
  // Projects keep tasks.json (save) order so the list never reshuffles on its
  // own; `recent` only sorts tasks. Manual reorder goes through `moveTask`.
  if (sortMode === "recent") {
    pinnedRegular.sort(compareRecent)
    regular.sort(compareRecent)
  }
  const rows: SidebarRow[] = []
  let flatIndex = 0
  for (const task of main) {
    rows.push({ kind: "task", task, flatIndex })
    flatIndex++
  }
  for (const task of pinnedRegular) {
    rows.push({ kind: "task", task, flatIndex })
    flatIndex++
  }
  for (const task of regular) {
    rows.push({ kind: "task", task, flatIndex })
    flatIndex++
  }
  return rows
}

/** Most-recently-touched first. Shared with the Inbox's RECENT section. */
export function compareRecent(a: Task, b: Task): number {
  const byTime = taskTime(b) - taskTime(a)
  if (byTime !== 0) return byTime
  return String(b.id).localeCompare(String(a.id))
}

function taskTime(task: Task): number {
  const parsed = Date.parse(task.updatedAt || task.createdAt)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Repo basename; a trailing slash doesn't change it. Main rows show this
 * instead of `task.title`, a stored copy that drifts if the dir is renamed.
 */
export function repoBasename(repo: string): string {
  return pathSyntax(repo).basename(repo) || repo
}

/**
 * Project row identity: `machineId + NUL + pathIdentity(repo)`. A path alone
 * would merge the same `~/i/kobe` on two machines into one row.
 * The local machine (`"local"`, the default) gets the bare path, so
 * single-machine keys are unchanged.
 */
export function sidebarProjectKey(repo: string, machineId = "local"): string {
  const path = pathIdentity(repo.trim()) || repo
  return machineId === "local" ? path : `${machineId}\u0000${path}`
}

/** The project key for a task, honouring the machine it came from. */
export function sidebarProjectKeyOfTask(task: Pick<Task, "repo" | "origin">): string {
  return sidebarProjectKey(task.repo, task.origin?.machineId ?? "local")
}

/** A repo as the label rules see it: its path plus the host it lives on. */
export interface LabelledRepo {
  readonly repo: string
  readonly hostLabel?: string
}

/**
 * Narrowest project header label that is unique on screen:
 *
 *   1. basename unique → `kobe`;
 *   2. shared on the SAME machine → last two segments (`gihub/kobe`), since
 *      the host name wouldn't distinguish them;
 *   3. shared only with another MACHINE → `host:basename` (`narwhal:kobe`);
 *      the local machine (no host label) keeps the bare name.
 *
 * Step 2 must precede 3: otherwise two checkouts on one remote machine both
 * read `narwhal:kobe`. A tail that also repeats across machines still gets
 * the host prefix. `repos` may be plain strings or {@link LabelledRepo}s.
 */
export function sidebarProjectLabel(
  repo: string,
  repos: readonly (string | LabelledRepo)[],
  hostLabel?: string,
): string {
  const base = repoBasename(repo)
  const host = hostLabel ?? ""
  const others = repos
    .map((entry) => (typeof entry === "string" ? { repo: entry } : entry))
    .filter((entry) => entry.repo !== repo || (entry.hostLabel ?? "") !== host)
  const collisions = others.filter((entry) => repoBasename(entry.repo) === base)
  if (collisions.length === 0) return base
  if (collisions.some((entry) => (entry.hostLabel ?? "") === host)) {
    const tail = pathTail(repo)
    // The tail settles the same-machine collision; only a tail that ALSO
    // repeats on another machine still needs the host in front of it.
    const tailRepeats = collisions.some((entry) => (entry.hostLabel ?? "") !== host && pathTail(entry.repo) === tail)
    return tailRepeats && host ? `${host}:${tail}` : tail
  }
  return host ? `${host}:${base}` : base
}

/** The last two path segments — `work/api`, `gihub/kobe`. */
function pathTail(repo: string): string {
  const syntax = pathSyntax(repo)
  return syntax.normalize(repo).split(syntax.sep).filter(Boolean).slice(-2).join("/")
}

export function buildProjectOptions(tasks: readonly Task[]): SidebarProjectOption[] {
  const byKey = new Map<string, { repo: string; count: number }>()
  for (const task of tasks) {
    // A `dir` task has no project; don't mint a phantom filter entry.
    if (task.kind === "dir") continue
    const key = sidebarProjectKey(task.repo)
    const next = byKey.get(key) ?? { repo: task.repo, count: 0 }
    if (task.kind === "main") {
      next.repo = task.repo
    } else {
      next.count += 1
    }
    byKey.set(key, next)
  }
  const repos = [...byKey.values()].map((entry) => entry.repo)
  // Stored order — matches the sidebar's PROJECTS section (no re-sort).
  return [...byKey.values()].map((entry) => ({
    repo: entry.repo,
    label: sidebarProjectLabel(entry.repo, repos),
    count: entry.count,
  }))
}

export function cursorIndexForProjectScope(rows: readonly SidebarRow[], projectFilter?: string | null): number {
  if (rows.length === 0) return -1
  if (!projectFilter) return rows[0]?.flatIndex ?? -1
  const projectKey = sidebarProjectKey(projectFilter)
  const firstTask = rows.find((row) => row.task.kind !== "main" && sidebarProjectKey(row.task.repo) === projectKey)
  if (firstTask) return firstTask.flatIndex
  const projectRow = rows.find((row) => row.task.kind === "main" && sidebarProjectKey(row.task.repo) === projectKey)
  return projectRow?.flatIndex ?? rows[0]?.flatIndex ?? -1
}

/**
 * Target cursor index after the selection or flat id list changed — sole
 * owner of the "follow selection / clamp into range" policy. `cursor` is -1
 * when unset.
 *
 *  - `selectedId === null`: keep the cursor; unset (-1) snaps to row 0,
 *    out-of-range clamps to the last row. (Empty list: a stray cursor >= 0
 *    resolves to 0; the view-switch reset corrects it.)
 *  - selected row present: follow it.
 *  - selected row absent: keep the cursor if in range, else the last row
 *    (-1 on an empty list).
 */
export function resolveCursorTarget(selectedId: string | null, flatIds: readonly string[], cursor: number): number {
  const len = flatIds.length
  if (selectedId === null) {
    if (cursor === -1 && len > 0) return 0
    if (cursor >= len) return Math.max(0, len - 1)
    if (len === 0) return -1
    return cursor
  }
  const idx = flatIds.indexOf(selectedId)
  if (idx >= 0) return idx
  if (len === 0) return -1
  if (cursor < 0 || cursor >= len) return len - 1
  return cursor
}

/**
 * Render-only partition so PROJECTS and TASKS get separate scrollboxes; the
 * flat list stays the navigation source of truth (indexes, identity unchanged).
 */
export function splitSidebarRows(rows: readonly SidebarRow[]): SidebarRowSections {
  const projectRows: SidebarRow[] = []
  const taskRows: SidebarRow[] = []
  for (const row of rows) {
    if (row.task.kind === "main") projectRows.push(row)
    else taskRows.push(row)
  }
  return { projectRows, taskRows }
}

/**
 * Equality over exactly the Task fields a sidebar row renders. The row reads
 * its captured task non-reactively, so a reused row freezes these fields —
 * a new rendered field MUST be added here or it renders stale.
 *
 * Excludes `createdAt`/`updatedAt`/`prStatus`: unrendered, and `updatedAt`
 * bumps on every `setActiveTask` touch, which would re-key the row on each
 * switch. `recent` ordering still sees `updatedAt` (in `buildRows`), and an
 * order change breaks reuse via `flatIndex`.
 */
export function sameSidebarRowTask(a: Task, b: Task): boolean {
  return (
    a === b ||
    (a.id === b.id &&
      a.kind === b.kind &&
      a.title === b.title &&
      a.repo === b.repo &&
      a.branch === b.branch &&
      a.worktreePath === b.worktreePath &&
      a.status === b.status &&
      a.pinned === b.pinned &&
      a.vendor === b.vendor)
  )
}

/**
 * Keep object identity for rows whose rendered fields are unchanged
 * (docs/DESIGN.md §5.5, long-lived-pane rule). Every `task.snapshot` push
 * deserializes all-new Tasks; lists key by identity, so without this each
 * push recreates every row's renderables, and @opentui/core 0.2.4 retains
 * ~300B native memory per create/destroy — unbounded over a days-long pane.
 *
 * Contract (mirrors filetree `reconcileRows`):
 * - same task id at the SAME flatIndex with {@link sameSidebarRowTask}-equal
 *   fields → the prev row object (flatIndex must match: the renderer
 *   captures it non-reactively for cursor compare + divider placement);
 * - all positions reused → the `prev` ARRAY itself, so downstream memos
 *   don't fire.
 */
export function reconcileSidebarRows(prev: readonly SidebarRow[], next: readonly SidebarRow[]): readonly SidebarRow[] {
  return reconcileStableRows(
    prev,
    next,
    (row) => row.task.id,
    (a, b) => a.flatIndex === b.flatIndex && sameSidebarRowTask(a.task, b.task),
    { samePosition: true },
  )
}
