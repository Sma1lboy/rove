/**
 * WHICH tasks the sidebar shows, WHICH project each one sits under, and in
 * WHAT order — as one pure answer both sidebar surfaces read.
 *
 * The sidebar renders in two shapes: the expanded tree (project header →
 * worktree → tab rows) and the folded rail (one cell per task, a divider per
 * project). They are different renderers on purpose — a fold that kept the
 * tree's row vocabulary would not be a fold. What they must never be is two
 * different ANSWERS: a project the tree hides has to be absent from the rail,
 * and a project's tasks have to sit in the same group, in the same order, in
 * both.
 *
 * So the seam is drawn between the two questions:
 *   - this module owns SELECTION, GROUPING and ORDER — one implementation,
 *     framework-free, and the only place the hide rules live;
 *   - `tree-core.ts` and `collapsed-rail.tsx` own PRESENTATION — how a group
 *     becomes rows or cells, which is where they are allowed to differ.
 *
 * Nothing here knows about tabs beyond whether a task HAS any: that single
 * fact is what "closed down to nothing" turns on, and keeping the rest of the
 * tab projection out is what lets this stay a pure function over `Task[]`.
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
export const SCRATCH_SECTION_LABEL = "Scratch"

/**
 * One section of the sidebar: a project, or the single scratch bench.
 *
 * `tasks` is the whole visible membership in render order — the user's own
 * tasks first, routine sessions last. The tree folds that tail behind its
 * count row; the rail has no fold and renders the array whole. That is a
 * difference in what each surface can DO with the group, not a difference in
 * what the group contains, which is the distinction that keeps them honest.
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
  /**
   * Tabs per task id — read ONLY for its size, and only as a tri-state:
   * absent means "never mounted since restart", which is every task on a
   * fresh TUI and must not be confused with "has no tabs".
   */
  readonly tabsByTask: ReadonlyMap<string, { readonly length: number }>
  /** Task sort applied within each group. Defaults to input order. */
  readonly sortMode?: TaskSortMode
  /** Live activity per task id — read only by `attention` sort, which ranks by
   *  the derived task group and so needs the entry, not just its state. */
  readonly activityOf?: (taskId: string) => TaskEngineState | undefined
}

/** True for a task the sidebar sorts to the end of its project. */
export function isRoutineTask(task: Task): boolean {
  return task.routine !== undefined
}

/** True for a task that belongs to the scratch bench rather than a project. */
function isScratchTask(task: Task): boolean {
  return task.kind === "dir" && task.scratch === true
}

/**
 * A project you closed down to nothing: its ONLY row is the repo's main
 * checkout (or a directory you opened), and that row's last tab is closed.
 *
 * Such a project is hidden from the sidebar. Nothing is deleted — the main
 * task and the `savedRepos` entry both stay.
 *
 * The way BACK is the new-task dialog's Existing tab: pick the repo and
 * choose "the project itself" instead of a new task worktree, which submits
 * `mode: "open"` and routes to `ensureMainTask`. That choice renders only for
 * a repo that already has a main row — which is exactly the set of repos this
 * rule can hide. Without it every submit path goes through `createTask`,
 * which always mints a `kind: "task"`, so picking a hidden repo would add a
 * worktree beside the project and still leave no project row.
 *
 * This is the whole difference from Forget (`d` on the row → `forgetProject`),
 * which un-saves the repo: closing the last tab is a "I'm done here for now"
 * gesture, not a "remove this from my machine" one.
 *
 * A `dir` row folds the same way. It has no picker entry to return through and
 * does not need one: the way back is the `rove .` that opened it in the first
 * place, and a directory is never in `savedRepos` to be lost from. Excluding
 * it would make "close the last tab" mean two different things depending on a
 * row kind the user never chose — the sidebar shows a folder and a checkout as
 * the same shape of row.
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
 * Ordering: projects follow their MAIN task's stored order (the same rule the
 * flat sidebar's PROJECTS section renders, and the same partition `moveTask`
 * reorders — so project move-mode visibly moves the header). A project's
 * first-seen regular task must NOT set its position: mains and regular tasks
 * interleave in tasks.json creation order, so keying on any-task order made a
 * main swap read as a no-op. Projects without a main (nothing to move) append
 * after, in first-seen order.
 *
 * A `main` task IS the project's main worktree, so it belongs to the group
 * rather than being the group: the header is a pure grouping token (a repo,
 * not a checkout), which is what lets "main" carry tabs like any other
 * worktree.
 *
 * `dir` tasks (`rove .` on an arbitrary directory) group under THEIR
 * DIRECTORY — their `repo` IS the directory, so the grouping rule is the same
 * one every task uses. Emitting them loose after the last project would read
 * as that project's rows.
 */
export function buildSidebarGroups(input: SidebarGroupInput): SidebarGroup[] {
  // A task whose deletion is in flight leaves the sidebar before anything is
  // destroyed. The daemon writes `deletion.phase = "queued"` and publishes the
  // resulting `task.snapshot` INSIDE the `task.delete` RPC, strictly before it
  // enqueues the worktree teardown — so dropping the task here is what turns
  // that accepted-request push into the thing the user asked for: the row goes
  // first, the minutes-long teardown runs behind it. Refusals (dirty worktree,
  // gitignored work, a main checkout) throw out of `prepare()` before that
  // write, so nothing is ever hidden for a delete that did not happen.
  //
  // `error` is deliberately kept. A failed deletion left the worktree AND the
  // task entry in place, so the task coming back — with the `delete failed`
  // caption the row builders already render, beside the daemon's toast — is
  // the only thing that corrects the row having vanished.
  const tasks = input.tasks.filter((task) => {
    const phase = task.deletion?.phase
    return phase !== "queued" && phase !== "running"
  })
  const { tabsByTask } = input
  const sortMode = input.sortMode ?? "default"
  // One comparator for both partitions below, resolved once: `default` keeps
  // the input (orchestrator) order and sorts nothing at all.
  const compare =
    sortMode === "recent"
      ? compareRecent
      : sortMode === "attention"
        ? compareTaskGroup(input.activityOf ?? (() => undefined))
        : null

  // Scratch tasks never mint a project header: their cwd is unsettled by
  // definition, so grouping them under their (temporary) directory would name
  // a home they don't have. They render in one Scratch section ABOVE every
  // project — the "unfiled live sessions" bench.
  const scratchTasks = tasks.filter(isScratchTask)
  if (compare) scratchTasks.sort(compare)

  const byProject = new Map<string, { repo: string; tasks: Task[] }>()
  for (const task of tasks) {
    if (isScratchTask(task)) continue
    const key = sidebarProjectKeyOfTask(task)
    const entry = byProject.get(key) ?? { repo: task.repo, tasks: [] }
    // The main task carries the canonical repo path — a regular task's `repo`
    // is the same value, but taking it from main keeps the header label stable
    // if they ever disagree.
    if (task.kind === "main") {
      entry.repo = task.repo
      entry.tasks.unshift(task)
    } else {
      entry.tasks.push(task)
    }
    byProject.set(key, entry)
  }

  // Project order = the mains' stored order (the partition moveTask swaps),
  // then main-less projects in first-seen order. Keying on first-seen ANY task
  // made project move-mode a no-op whenever an older regular task anchored the
  // group ahead of its main.
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
        // Keep the repo's main checkout first under its own header; only the
        // regular worktrees reorder.
        if (a.kind === "main" && b.kind !== "main") return -1
        if (b.kind === "main" && a.kind !== "main") return 1
        return compare(a, b)
      })
    }
  }

  // Header labels disambiguate against EVERY other project on screen, not just
  // against themselves: with 5 repos open, `~/work/api` and `~/oss/api` both
  // rendered the bare basename `api`, so two headers read as one repo while
  // the toast that had just named one of them said `work/api`.
  //
  // Projects closed down to nothing drop out entirely. Computed BEFORE the
  // label pass so a hidden project can't influence how the visible ones
  // disambiguate.
  const visibleKeys = orderedKeys.filter((key) => {
    const entry = byProject.get(key)
    return entry ? !isClosedDownProject(entry.tasks, tabsByTask) : false
  })
  const projectRepos: LabelledRepo[] = visibleKeys.map((key) => {
    const entry = byProject.get(key)
    return { repo: entry?.repo ?? "", hostLabel: hostLabelOf(entry?.tasks[0]) }
  })

  const groups: SidebarGroup[] = []
  // The scratch bench leads: it is the shortest-lived work on screen, and the
  // one thing you reach for without having filed it anywhere.
  if (scratchTasks.length > 0) {
    groups.push({
      key: SCRATCH_SECTION_ID,
      repo: "",
      label: SCRATCH_SECTION_LABEL,
      machineId: "local",
      tasks: scratchTasks,
      // A scratch session is never a routine: a schedule files its output
      // under the repo it ran in, which is what gives it a project at all.
      routineCount: 0,
    })
  }
  for (const key of visibleKeys) {
    const entry = byProject.get(key)
    if (!entry) continue
    // Routine sessions sort to the END of their project: they are a schedule's
    // output, so they must never push the tasks the user opened themselves
    // down the pane.
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
 * Every project key, in the same order `buildSidebarGroups` emits its
 * sections — what "focus one project" needs in order to know which others to
 * fold. Unlike the groups themselves this answers over the RAW task list,
 * including projects the hide rule drops: the caller is naming keys, not
 * rendering rows.
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
