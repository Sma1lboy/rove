/**
 * Which tasks the sidebar shows, under which project, in what order — one pure
 * answer shared by the expanded tree and the folded rail. The two may render
 * differently (`tree-core.ts`, `collapsed-rail.tsx`) but must never disagree
 * on membership or order: a project the tree hides is absent from the rail.
 * This is the only place the hide rules live.
 *
 * Tabs matter here only as "does the task have any" — what "closed down to
 * nothing" turns on.
 */

import type { TaskEngineState } from "@/client/remote-orchestrator"
import {
  type ProjectKeyOf,
  type TaskSortMode,
  compareName,
  compareNewest,
  isNoProjectTask,
  nameCollator,
  sidebarProjectKeyOfTask,
  sidebarProjectKeyResolver,
  sidebarRepoLabel,
} from "@sma1lboy/rove-client/sidebar/groups.ts"
import { isUnlistedCheckout } from "@sma1lboy/rove-core/lib/worktree-only.ts"
import type { Task } from "@sma1lboy/rove-core/types/task.ts"
import { workspaceBackendId } from "@sma1lboy/rove-daemon/workspace"
import { compareTaskGroup } from "./task-group-view"
import { SCRATCH_SECTION_ID } from "./tree-ids"

/** The label the Ungrouped section carries; the renderer translates it. */
const UNGROUPED_SECTION_LABEL = "Ungrouped"

/** One sidebar section: a project, or the single scratch bench. */
export interface SidebarGroup {
  /** Project key, or `SCRATCH_SECTION_ID` for the scratch bench. */
  readonly key: string
  /** The HOME checkout's repo path (see `sidebarProjectKeyResolver`); `""` for scratch. */
  readonly repo: string
  /** Header text, already disambiguated against every other VISIBLE group —
   *  so `~/work/api` and `~/oss/api` never both render as `api`. */
  readonly label: string
  /** The home checkout's machine — what a project action on the header acts
   *  on; `"local"` when the repo is checked out on this computer. Its tasks
   *  may live on any machine (each keeps its own `origin`). */
  readonly machineId: string
  /** Every visible task, in render order. */
  readonly tasks: readonly Task[]
  /** The chat connector whose session this project holds (`weixin`, `lark`): the header names the app, not the directory. */
  readonly connector?: string
}

export interface SidebarGroupInput {
  readonly tasks: readonly Task[]
  /** Tabs per task id, read only for size, as a tri-state: absent = "never
   *  mounted since restart" (every task on a fresh TUI), not "has no tabs". */
  readonly tabsByTask: ReadonlyMap<string, { readonly length: number }>
  /** Task sort applied within each group. Defaults to input order. */
  readonly sortMode?: TaskSortMode
  /** Live activity per task id — read only by `attention` sort, which ranks by
   *  the derived task group and so needs the entry, not just its state. */
  readonly activityOf?: (taskId: string) => TaskEngineState | undefined
}

/** One project while it is being gathered: the home checkout plus every machine's tasks. */
interface ProjectEntry {
  repo: string
  repoId?: string
  machineId: string
  newest: number
  /** A task of the home checkout has been seen: it names the header. */
  home: boolean
  tasks: Task[]
}

/**
 * A project closed down to nothing: its only row is a session in an existing
 * directory and that row's tabs are KNOWN and empty. Hidden, not deleted — the
 * row and the `savedRepos` entry stay (unlike Forget, which un-saves).
 *
 * Way back: new-task dialog → Existing → "the project itself", or `rove .`.
 *
 * Narrow on purpose: any worktree task under the project keeps it visible
 * (those rows are the way back to that work), and an absent tabs entry never
 * hides — else the sidebar would boot empty.
 */
function isClosedDownProject(tasks: readonly Task[], tabsByTask: SidebarGroupInput["tabsByTask"]): boolean {
  const only = tasks.length === 1 ? tasks[0] : undefined
  if (!only || workspaceBackendId(only) !== "borrowed") return false
  return tabsByTask.get(only.id)?.length === 0
}

/** Not on its way out (a queued or running delete leaves every list at once) and not a bare checkout under its parent. */
function isListed(task: Task): boolean {
  const phase = task.deletion?.phase
  return phase !== "queued" && phase !== "running" && !isUnlistedCheckout(task)
}

/** A routine's run: it lives on the Routines page, not in the sidebar (the web rail's rule). */
function isRoutineRun(task: Task): boolean {
  return task.routine !== undefined
}

/**
 * Build the sidebar's sections.
 *
 * ONE list of projects from every machine (Claude Desktop's sidebar, the web
 * rail): checkouts of the same repo (`repoId`) on several machines are one
 * project, its tasks from every machine under it; which machine a row lives
 * on is the row's business (`task.origin`), not a section of its own.
 *
 * In manual order a project sits where its first task does (`moveProject`
 * moves the whole block). `dir` tasks group under their directory (`repo` IS
 * the directory); loose after the last project they would read as that project's rows.
 */
export function buildSidebarGroups(input: SidebarGroupInput): SidebarGroup[] {
  // In-flight deletions leave the sidebar before teardown: the daemon
  // publishes `deletion.phase = "queued"` inside the `task.delete` RPC,
  // strictly before enqueueing teardown, and refusals throw from `prepare()`
  // before that write — so nothing hides for a delete that didn't happen.
  // `error` stays visible: the failed task returning (with its `delete failed`
  // caption) is the only thing that corrects the vanished row.
  // Archived tasks leave too (the palette finds them by title); so do
  // routine runs, so a project with only scheduled output folds away.
  const tasks = input.tasks.filter((task) => isListed(task) && task.archived !== true && !isRoutineRun(task))
  const { tabsByTask } = input
  const sortMode = input.sortMode ?? "default"
  const compare =
    sortMode === "recent"
      ? compareNewest
      : sortMode === "attention"
        ? compareTaskGroup(input.activityOf ?? (() => undefined))
        : sortMode === "name"
          ? compareName
          : null

  // No-project tasks never mint a project header — their cwd is temporary or
  // synthetic, so it would name a home they don't have. One section above all projects.
  const scratchTasks = tasks.filter(isNoProjectTask)
  const pinnedFirst = (a: Task, b: Task) =>
    Number(b.pinned === true) - Number(a.pinned === true) || (compare?.(a, b) ?? 0)
  scratchTasks.sort(pinnedFirst)

  const keyOf = sidebarProjectKeyResolver(tasks)
  const byProject = new Map<string, ProjectEntry>()
  for (const task of tasks) {
    if (isNoProjectTask(task)) continue
    const key = keyOf(task)
    const entry = byProject.get(key) ?? {
      repo: task.repo,
      machineId: task.origin?.machineId ?? "local",
      home: false,
      newest: 0,
      tasks: [],
    }
    if (!entry.repoId && task.repoId) entry.repoId = task.repoId
    // The header names the HOME checkout (the one the key came from).
    if (!entry.home && sidebarProjectKeyOfTask(task) === key) {
      entry.repo = task.repo
      entry.machineId = task.origin?.machineId ?? "local"
      entry.home = true
    }
    if (sortMode === "recent") entry.newest = Math.max(entry.newest, Date.parse(task.createdAt) || 0)
    entry.tasks.push(task)
    byProject.set(key, entry)
  }

  const visible = [...byProject.entries()].filter(([, entry]) => !isClosedDownProject(entry.tasks, tabsByTask))
  const projects = visible.map(([, entry]) => entry)
  if (sortMode === "recent") visible.sort(([, a], [, b]) => b.newest - a.newest)
  const groups: SidebarGroup[] = visible.map(([key, entry]) => {
    const connector = entry.tasks.find((task) => task.connector)?.connector
    return {
      key,
      repo: entry.repo,
      label: sidebarRepoLabel(entry, projects),
      machineId: entry.machineId,
      tasks: entry.tasks.sort(pinnedFirst),
      ...(connector ? { connector } : {}),
    }
  })
  if (sortMode === "name") groups.sort((a, b) => nameCollator.compare(a.label, b.label))
  // A chat connector's session (WeChat, Lark) sinks below every project, whatever the sort (the web rail's rule).
  const connector = (group: SidebarGroup): number => Number(group.connector !== undefined)
  groups.sort((a, b) => connector(a) - connector(b))
  if (scratchTasks.length > 0) {
    groups.unshift({
      key: SCRATCH_SECTION_ID,
      repo: "",
      label: UNGROUPED_SECTION_LABEL,
      machineId: "local",
      tasks: scratchTasks,
    })
  }
  return groups
}

/**
 * Every project key, in first-seen task order, for "focus one project" to know
 * which others to fold. Over the RAW list, including hidden projects: the
 * caller names keys, it doesn't render rows.
 */
export function projectKeysOf(tasks: readonly Task[]): string[] {
  const keyOf = sidebarProjectKeyResolver(tasks)
  const keys: string[] = []
  const seen = new Set<string>()
  for (const task of tasks) {
    const key = ownerProjectKey(task, keyOf)
    if (key === null || seen.has(key)) continue
    seen.add(key)
    keys.push(key)
  }
  return keys
}

/** The project a task belongs to. A `dir` task's project is its directory; a
 *  scratch task's is the one shared bench. `keyOf` is the list's
 *  {@link sidebarProjectKeyResolver} — without it a task on another machine
 *  answers its own checkout, not the merged project. */
export function ownerProjectKey(task: Task, keyOf: ProjectKeyOf = sidebarProjectKeyOfTask): string | null {
  if (isNoProjectTask(task)) return SCRATCH_SECTION_ID
  return keyOf(task)
}
