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
  type LabelledRepo,
  type TaskSortMode,
  compareRecent,
  sidebarProjectKeyOfTask,
  sidebarProjectLabel,
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
  /** The repo path the header names; `""` for scratch. */
  readonly repo: string
  /** Header text, already disambiguated against every other VISIBLE group —
   *  so `~/work/api` and `~/oss/api` never both render as `api`. */
  readonly label: string
  /** Which machine's checkout this is; `"local"` for this computer. */
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

/** The host a group's header displays under — undefined for the local
 *  machine, so a machine-free sidebar carries no host anywhere. */
function hostLabelOf(task: Task | undefined): string | undefined {
  const origin = task?.origin
  if (!origin || origin.machineId === "local") return undefined
  return origin.hostLabel || origin.machineId
}

/**
 * Build the sidebar's sections.
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
      ? compareRecent
      : sortMode === "attention"
        ? compareTaskGroup(input.activityOf ?? (() => undefined))
        : null

  // Scratch tasks never mint a project header — their cwd is temporary, so it
  // would name a home they don't have. One Scratch section above all projects.
  const scratchTasks = tasks.filter(isScratchTask)
  if (compare) scratchTasks.sort(compare)

  const byProject = new Map<string, { repo: string; tasks: Task[] }>()
  for (const task of tasks) {
    if (isScratchTask(task)) continue
    const key = sidebarProjectKeyOfTask(task)
    const entry = byProject.get(key) ?? { repo: task.repo, tasks: [] }
    // Main's `repo` wins, keeping the header stable if they ever disagree.
    if (task.kind === "main") {
      entry.repo = task.repo
      entry.tasks.unshift(task)
    } else {
      entry.tasks.push(task)
    }
    byProject.set(key, entry)
  }

  // Mains' stored order, then main-less projects first-seen (see above).
  const orderedKeys: string[] = []
  const seen = new Set<string>()
  for (const task of tasks) {
    if (task.kind !== "main") continue
    const key = sidebarProjectKeyOfTask(task)
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

  if (compare) {
    for (const entry of byProject.values()) {
      entry.tasks.sort((a, b) => {
        // Main stays first; only regular worktrees reorder.
        if (a.kind === "main" && b.kind !== "main") return -1
        if (b.kind === "main" && a.kind !== "main") return 1
        return compare(a, b)
      })
    }
  }

  // Labels disambiguate against every other VISIBLE project (`~/work/api` vs
  // `~/oss/api` must not both read `api`). Hidden projects are dropped first
  // so they can't influence that.
  const visibleKeys = orderedKeys.filter((key) => {
    const entry = byProject.get(key)
    return entry ? !isClosedDownProject(entry.tasks, tabsByTask) : false
  })
  const projectRepos: LabelledRepo[] = visibleKeys.map((key) => {
    const entry = byProject.get(key)
    return { repo: entry?.repo ?? "", hostLabel: hostLabelOf(entry?.tasks[0]) }
  })

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
    if (!entry) continue
    // Routines go last so a schedule's output never pushes the user's own
    // tasks down the pane.
    const own = entry.tasks.filter((task) => !isRoutineTask(task))
    const routines = entry.tasks.filter(isRoutineTask)
    groups.push({
      key,
      repo: entry.repo,
      label: sidebarProjectLabel(entry.repo, projectRepos, hostLabelOf(entry.tasks[0])),
      machineId: entry.tasks[0]?.origin?.machineId ?? "local",
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

/** The project a task belongs to — exported for `tree-search`, which prunes by
 *  the same grouping this module builds with. A `dir` task's project is its
 *  directory; a scratch task's is the one shared bench. */
export function ownerProjectKey(task: Task): string | null {
  if (isScratchTask(task)) return SCRATCH_SECTION_ID
  return sidebarProjectKeyOfTask(task)
}

/**
 * A group's own tasks, minus the routine tail. Both surfaces hide that tail at
 * rest, so this — not `group.tasks` — is "the tasks on screen".
 */
export function ownTasks(group: SidebarGroup): readonly Task[] {
  return group.tasks.slice(0, group.tasks.length - group.routineCount)
}
