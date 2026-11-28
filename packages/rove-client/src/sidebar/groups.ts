/**
 * Pure list-shaping helpers for the sidebar pane. Selected-task repo/branch
 * metadata lives in the topbar, not here.
 */

import { reconcileStableRows } from "@sma1lboy/rove-core/lib/stable-rows.ts"
import type { Task } from "@sma1lboy/rove-core/types/task.ts"
import { pathIdentity, pathSyntax } from "@sma1lboy/rove-daemon/path-identity"

/**
 * `attention` ranks by derived task group (what needs a person next). Its
 * comparator (`compareTaskGroup`) lives in `task-group-view.ts`, which
 * imports this module, so it can't live here.
 */
export type TaskSortMode = "default" | "recent" | "attention" | "name"

/** One visible sidebar row; kept a discriminated union so new row kinds slot in. */
export type SidebarRow = { kind: "task"; task: Task; flatIndex: number }

/**
 * Newest-created first: the `recent` sort. Not `updatedAt`, which also moves on bookkeeping
 * (a first open, a PR poll) and would reorder rows under a click.
 */
export function compareNewest(a: Task, b: Task): number {
  const byTime = Date.parse(b.createdAt) - Date.parse(a.createdAt)
  if (Number.isFinite(byTime) && byTime !== 0) return byTime
  return String(b.id).localeCompare(String(a.id))
}

/** Most-recently-touched first. Shared with the Inbox's RECENT section. */
export function compareRecent(a: Task, b: Task): number {
  const byTime = taskTime(b) - taskTime(a)
  if (byTime !== 0) return byTime
  return String(b.id).localeCompare(String(a.id))
}

export const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })

/** A→Z by title, numbers in numeric order (`task 2` before `task 10`). */
export function compareName(a: Task, b: Task): number {
  const byName = nameCollator.compare(a.title.trim(), b.title.trim())
  if (byName !== 0) return byName
  return String(a.id).localeCompare(String(b.id))
}

function taskTime(task: Task): number {
  const parsed = Date.parse(task.updatedAt || task.createdAt)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Repo basename; a trailing slash doesn't change it.
 */
export function repoBasename(repo: string): string {
  return pathSyntax(repo).basename(repo) || repo
}

/**
 * Project row identity: `machineId + NUL + pathIdentity(repo)`. A path alone
 * would merge the same `~/i/rove` on two machines into one row.
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

/** Maps a task to the project key its sidebar header carries. */
export type ProjectKeyOf = (task: Pick<Task, "repo" | "origin" | "repoId">) => string

function isLocalTask(task: Pick<Task, "origin">): boolean {
  return (task.origin?.machineId ?? "local") === "local"
}

/** A task that sits in the "Ungrouped" group: a scratch shell or a projectless routine's dir. */
export function isNoProjectTask(task: Task): boolean {
  return task.kind === "dir" && (task.scratch === true || task.noProject === true)
}

/**
 * One project per REPO across machines, the way the web rail merges by
 * `repoId`: every checkout (machine + path) whose tasks name the same
 * `repoId` resolves to ONE key — the HOME checkout's own
 * {@link sidebarProjectKeyOfTask}: this machine's when the repo is checked out
 * here (its main first), else the first other machine's. Keying on the home
 * checkout rather than the id keeps a single-machine sidebar's keys (fold
 * state, routines rows, move mode) byte-identical, and makes a project action
 * on the header land on the home checkout. A checkout with no `repoId` keeps
 * its own per-machine key.
 *
 * Tasks being deleted and scratch tasks never pick the home: the former are
 * leaving the sidebar, the latter have no project.
 */
export function sidebarProjectKeyResolver(tasks: readonly Task[]): ProjectKeyOf {
  const counted = tasks.filter((task) => {
    const phase = task.deletion?.phase
    if (phase === "queued" || phase === "running") return false
    return !isNoProjectTask(task)
  })
  // A checkout's repoId: the first of its tasks that carries one (the web's `groupByProject`).
  const repoIdOf = new Map<string, string>()
  for (const task of counted) {
    if (!task.repoId) continue
    const key = sidebarProjectKeyOfTask(task)
    if (!repoIdOf.has(key)) repoIdOf.set(key, task.repoId)
  }
  if (repoIdOf.size === 0) return sidebarProjectKeyOfTask
  const home = new Map<string, { key: string; rank: number }>()
  for (const task of counted) {
    const key = sidebarProjectKeyOfTask(task)
    const id = repoIdOf.get(key)
    if (!id) continue
    const rank = isLocalTask(task) ? 0 : 1
    const current = home.get(id)
    if (!current || rank < current.rank) home.set(id, { key, rank })
  }
  return (task) => {
    const key = sidebarProjectKeyOfTask(task)
    const id = repoIdOf.get(key)
    return (id && home.get(id)?.key) || key
  }
}

/** `owner/name` of a `host/owner/name` repo id; a `root:` id has no readable name. */
function repoIdTail(id: string): string | null {
  return id.startsWith("root:") ? null : id.split("/").slice(-2).join("/")
}

/** A merged project as {@link sidebarRepoLabel} sees it. */
export interface LabelledProject {
  readonly repo: string
  readonly repoId?: string
}

/**
 * Header label for a project merged across machines (the web rail's
 * `mergedLabel`): the repo basename, widened only to tell DIFFERENT repos
 * apart — `owner/name` from the repo id (the whole id when even that
 * repeats), else the path tail. Never the host: a project is one header
 * wherever it is checked out, and each remote row carries its own mark.
 */
export function sidebarRepoLabel(project: LabelledProject, all: readonly LabelledProject[]): string {
  const base = repoBasename(project.repo)
  const others = all.filter((other) => other !== project && repoBasename(other.repo) === base)
  if (others.length === 0) return base
  const id = project.repoId
  const tail = id ? repoIdTail(id) : null
  if (id && tail) {
    const tailRepeats = others.some((other) => other.repoId && other.repoId !== id && repoIdTail(other.repoId) === tail)
    return tailRepeats ? id : tail
  }
  return sidebarProjectLabel(
    project.repo,
    others.map((other) => other.repo),
  )
}

/** A repo as the label rules see it: its path plus the host it lives on. */
export interface LabelledRepo {
  readonly repo: string
  readonly hostLabel?: string
}

/**
 * Narrowest project header label that is unique on screen:
 *
 *   1. basename unique → `rove`;
 *   2. shared on the SAME machine → last two segments (`gihub/rove`), since
 *      the host name wouldn't distinguish them;
 *   3. shared only with another MACHINE → `host:basename` (`narwhal:rove`);
 *      the local machine (no host label) keeps the bare name.
 *
 * Step 2 must precede 3: otherwise two checkouts on one remote machine both
 * read `narwhal:rove`. A tail that also repeats across machines still gets
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

/** The last two path segments — `work/api`, `gihub/rove`. */
function pathTail(repo: string): string {
  const syntax = pathSyntax(repo)
  return syntax.normalize(repo).split(syntax.sep).filter(Boolean).slice(-2).join("/")
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
 * Equality over exactly the Task fields a sidebar row renders. The row reads
 * its captured task non-reactively, so a reused row freezes these fields —
 * a new rendered field MUST be added here or it renders stale.
 *
 * Excludes `createdAt`/`updatedAt`/`prStatus`: unrendered, and `updatedAt`
 * moves on every real mutation, which would re-key the row each time. An
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
