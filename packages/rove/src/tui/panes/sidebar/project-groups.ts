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
import type { Task } from "@/types/task"
import {
  type LabelledProject,
  type ProjectKeyOf,
  type TaskSortMode,
  compareName,
  compareNewest,
  sidebarProjectKeyOfTask,
  sidebarProjectKeyResolver,
  sidebarRepoLabel,
} from "./groups"
import { compareTaskGroup } from "./task-group-view"
import { SCRATCH_SECTION_ID } from "./tree-ids"

/** The label the scratch section carries; the renderer translates it. */
const SCRATCH_SECTION_LABEL = "Scratch"

/**
 * One sidebar section: a project, or the single scratch bench. `tasks` is the
 * whole visible membership; how much of the routine tail each surface draws
 * is presentation, not membership.
 */
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
  /** Every visible task, in render order: the user's own, then routines. */
  readonly tasks: readonly Task[]
  /** How many of the TRAILING `tasks` are routine sessions. */
  readonly routineCount: number
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
  /** The home checkout's main has been seen (it heads `mains`). */
  homeMain: boolean
  mains: Task[]
  rest: Task[]
}

/** True for a task the sidebar sorts to the end of its project. */
function isRoutineTask(task: Task): boolean {
  return task.routine !== undefined
}

/** True for a task that belongs to the scratch bench rather than a project. */
function isScratchTask(task: Task): boolean {
  return task.kind === "dir" && task.scratch === true
}

/**
 * A project closed down to nothing: its only row is the main checkout (or an
 * opened `dir`) and that row's tabs are KNOWN and empty. Hidden, not deleted —
 * the main task and `savedRepos` entry stay (unlike Forget, which un-saves).
 *
 * Way back: new-task dialog → Existing → "the project itself" (`mode: "open"`
 * → `ensureMainTask`), offered exactly for repos with a main row. Every other
 * submit path goes through `createTask`, which mints a worktree and would
 * leave no project row. A `dir` row comes back via `rove .`.
 *
 * Narrow on purpose: any worktree task under the project keeps it visible
 * (those rows are the way back to that work), and an absent tabs entry never
 * hides — else the sidebar would boot empty.
 */
function isClosedDownProject(tasks: readonly Task[], tabsByTask: SidebarGroupInput["tabsByTask"]): boolean {
  const only = tasks.length === 1 ? tasks[0] : undefined
  if (!only || (only.kind !== "main" && only.kind !== "dir")) return false
  return tabsByTask.get(only.id)?.length === 0
}

/**
 * Build the sidebar's sections.
 *
 * ONE list of projects from every machine (Claude Desktop's sidebar, the web
 * rail): checkouts of the same repo (`repoId`) on several machines are one
 * project, its tasks from every machine under it; which machine a row lives
 * on is the row's business (`task.origin`), not a section of its own.
 *
 * Projects follow their MAIN task's stored order (the partition `moveTask`
 * reorders, so project move-mode visibly moves the header); keying on any
 * task's order would make a main swap a no-op, since mains and regular tasks
 * interleave in tasks.json. Main-less projects append in first-seen order.
 *
 * A `main` task belongs to its group rather than being it — the header is a
 * repo, not a checkout — so main carries tabs like any worktree. `dir` tasks
 * group under their directory (`repo` IS the directory); loose after the last
 * project they would read as that project's rows.
 */
export function buildSidebarGroups(input: SidebarGroupInput): SidebarGroup[] {
  // In-flight deletions leave the sidebar before teardown: the daemon
  // publishes `deletion.phase = "queued"` inside the `task.delete` RPC,
  // strictly before enqueueing teardown, and refusals throw from `prepare()`
  // before that write — so nothing hides for a delete that didn't happen.
  // `error` stays visible: the failed task returning (with its `delete failed`
  // caption) is the only thing that corrects the vanished row.
  const tasks = input.tasks.filter((task) => {
    const phase = task.deletion?.phase
    return phase !== "queued" && phase !== "running"
  })
  const { tabsByTask } = input
  const sortMode = input.sortMode ?? "default"
  // `default` keeps orchestrator order and sorts nothing.
  const compare =
    sortMode === "recent"
      ? compareNewest
      : sortMode === "attention"
        ? compareTaskGroup(input.activityOf ?? (() => undefined))
        : sortMode === "name"
          ? compareName
          : null

  // Scratch tasks never mint a project header — their cwd is temporary, so it
  // would name a home they don't have. One Scratch section above all projects.
  const scratchTasks = tasks.filter(isScratchTask)
  if (compare) scratchTasks.sort(compare)

  const keyOf = sidebarProjectKeyResolver(tasks)
  const byProject = new Map<string, ProjectEntry>()
  for (const task of tasks) {
    if (isScratchTask(task)) continue
    const key = keyOf(task)
    const entry = byProject.get(key) ?? {
      repo: task.repo,
      machineId: task.origin?.machineId ?? "local",
      homeMain: false,
      mains: [],
      rest: [],
    }
    if (!entry.repoId && task.repoId) entry.repoId = task.repoId
    // The header names the HOME checkout (the one the key came from), its
    // main's `repo` winning so the header stays stable if they disagree.
    const home = sidebarProjectKeyOfTask(task) === key
    if (home && !entry.homeMain) {
      entry.repo = task.repo
      entry.machineId = task.origin?.machineId ?? "local"
      entry.homeMain = task.kind === "main"
      // The home main heads the project; other machines' mains follow it.
      if (entry.homeMain) {
        entry.mains.unshift(task)
        byProject.set(key, entry)
        continue
      }
    }
    if (task.kind === "main") entry.mains.push(task)
    else entry.rest.push(task)
    byProject.set(key, entry)
  }

  // Mains' stored order, then main-less projects first-seen (see above).
  const orderedKeys: string[] = []
  const seen = new Set<string>()
  for (const task of tasks) {
    if (task.kind !== "main") continue
    const key = keyOf(task)
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

  // Mains stay first; only regular worktrees reorder.
  const ordered = new Map<string, Task[]>()
  for (const [key, entry] of byProject) {
    if (compare) entry.rest.sort(compare)
    ordered.set(key, [...entry.mains, ...entry.rest])
  }

  // Labels disambiguate against every other VISIBLE project (`~/work/api` vs
  // `~/oss/api` must not both read `api`). Hidden projects are dropped first
  // so they can't influence that.
  const visibleKeys = orderedKeys.filter((key) => {
    const list = ordered.get(key)
    return list ? !isClosedDownProject(list, tabsByTask) : false
  })
  const labelled = new Map<string, LabelledProject>()
  for (const key of visibleKeys) {
    const entry = byProject.get(key)
    if (entry) labelled.set(key, { repo: entry.repo, ...(entry.repoId ? { repoId: entry.repoId } : {}) })
  }
  const projects = [...labelled.values()]

  const groups: SidebarGroup[] = []
  if (scratchTasks.length > 0) {
    groups.push({
      key: SCRATCH_SECTION_ID,
      repo: "",
      label: SCRATCH_SECTION_LABEL,
      machineId: "local",
      tasks: scratchTasks,
      // Never a routine: a schedule files output under the repo it ran in.
      routineCount: 0,
    })
  }
  for (const key of visibleKeys) {
    const entry = byProject.get(key)
    const list = ordered.get(key)
    const project = labelled.get(key)
    if (!entry || !list || !project) continue
    // Routines go last so a schedule's output never pushes the user's own
    // tasks down the pane.
    const own = list.filter((task) => !isRoutineTask(task))
    const routines = list.filter(isRoutineTask)
    groups.push({
      key,
      repo: entry.repo,
      label: sidebarRepoLabel(project, projects),
      machineId: entry.machineId,
      tasks: [...own, ...routines],
      routineCount: routines.length,
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
  if (isScratchTask(task)) return SCRATCH_SECTION_ID
  return keyOf(task)
}

/**
 * A group's own tasks, minus the routine tail. Both surfaces hide that tail at
 * rest, so this — not `group.tasks` — is "the tasks on screen".
 */
export function ownTasks(group: SidebarGroup): readonly Task[] {
  return group.tasks.slice(0, group.tasks.length - group.routineCount)
}
