/**
 * Minting a task ROW — the one cluster in `core.ts` that was real logic rather
 * than a delegation to a coordinator, which is why the file splits here.
 *
 * Three entry points, three shapes of new row: a repo-backed task (lazy
 * worktree), a standalone directory task (`rove .`), and the adoption that
 * turns a scratch shell into a repo-homed one. They take the store (and, for
 * the first, the main-task coordinator) rather than the Orchestrator, so the
 * class above stays the thin delegator its own doc comment claims to be —
 * the same division `landTaskWithCleanup` already follows.
 */

import { resolvePreferredVendor } from "../state/vendor-prefs.ts"
import type { Task, TaskId, VendorId } from "../types/task.ts"
import { DEFAULT_TASK_VENDOR } from "../types/task.ts"
import { canonPath, normalizeMainRepo, randomDirTaskSuffix, titleFromRepo } from "./core-helpers.ts"
import type { CreateTaskInput } from "./create-task-input.ts"
import type { TaskIndexStore } from "./index/store.ts"
import type { MainTaskCoordinator } from "./main-task.ts"
import { PLACEHOLDER_TASK_TITLE, sanitizeTaskTitle } from "./title.ts"

/** The store alone — all a directory/scratch row needs. */
export interface StoreDeps {
  readonly store: TaskIndexStore
}

/** Plus the project-row coordinator, for a repo-backed task. */
export interface CreateDeps extends StoreDeps {
  readonly mainTasks: MainTaskCoordinator
}

/** Options for {@link openDirectoryTaskRow}. */
export interface OpenDirectoryTaskInput {
  readonly dir: string
  readonly vendor?: VendorId
  /** Temp shell task for the sidebar's Scratch section: same dir-task shape,
   *  `scratch: true`, shell-exit deletes the row. */
  readonly scratch?: boolean
}

/**
 * Create a new task entry. Worktree allocation is lazy — the `worktreePath`
 * field stays empty until `ensureWorktree` is called (typically when the user
 * enters the task for the first time).
 */
export async function createTaskRow(deps: CreateDeps, input: CreateTaskInput): Promise<Task> {
  if (!input.repo) throw new Error("createTask: repo is required")
  // Bring the project row into existence alongside the task — but only if
  // the repo may BE a project (state/project-eligibility.ts). A `/tmp`
  // fixture or a checkout inside `.dev-sandbox` still gets its task; it
  // just stops leaving a permanent sidebar row behind — which is how a
  // project list reaches a dozen rows on two saved repos. `buildTreeRows`
  // groups a main-less task under a header derived from its own repo, so
  // the task still renders — the header just dies with it.
  //
  // Normalize to the git toplevel regardless of that outcome. A caller
  // passing a SUBDIRECTORY (`rove` run from `my-monorepo/packages/app`,
  // whose path passes `validateRepoPath` because `rev-parse --git-dir`
  // succeeds in a subdir) otherwise splits into two sidebar projects: the
  // main row keyed on `/my-monorepo`, this task keyed on
  // `/my-monorepo/packages/app` — a ghost project named after a
  // subdirectory, with its own worktree root. Taking the normalization from
  // `normalizeMainRepo` directly, rather than off the returned main row,
  // keeps it working when no row is created.
  // Dir/scratch tasks do NOT come through here (see openDirectoryTask),
  // so pinning a user-owned directory is unaffected.
  const mainTask = await deps.mainTasks.ensureIfEligible(input.repo, input.projectIntent ?? "explicit")
  const repo = mainTask?.repo ?? normalizeMainRepo(input.repo).repo
  const title = sanitizeTaskTitle(input.title ?? PLACEHOLDER_TASK_TITLE) || PLACEHOLDER_TASK_TITLE
  // Leave the branch EMPTY for a lazily-allocated task (unless the caller
  // gave an explicit one): {@link ensureWorktree} derives a repo-convention
  // name (branch-style.ts) with collision suffixes when the worktree
  // materialises. We must NOT pre-derive a branch here — uniqueness is
  // resolved against the repo's live branch list at materialise time, and
  // deferring also lets the branch follow a rename made before first enter.
  const task = await deps.store.create({
    repo,
    title,
    branch: input.branch ?? "",
    worktreePath: "",
    status: "backlog",
    kind: "task",
    vendor: input.vendor ?? DEFAULT_TASK_VENDOR,
    ...(input.command?.trim() ? { command: input.command.trim() } : {}),
    ...(input.modelEffort ? { modelEffort: input.modelEffort } : {}),
    ...(input.groupId ? { groupId: input.groupId } : {}),
    ...(input.dispatcher ? { dispatcher: input.dispatcher } : {}),
    ...(input.routine ? { routine: input.routine } : {}),
    // Persisted ON the task (not a one-shot side-map): `ensureWorktree`
    // reads it whenever the worktree materialises — including after a
    // daemon restart between create and first enter — and `collect`'s
    // branch signals compare against the recorded fork point instead of
    // re-guessing the base.
    ...(input.baseRef?.trim() ? { baseRef: input.baseRef.trim() } : {}),
  })
  return task
}

/**
 * Open an existing directory as a standalone `kind: "dir"` task (`rove .`).
 * Deliberately NO project association: no main task is ensured, no worktree or
 * branch is created — the task pins the directory itself and deletion later
 * only drops the index entry. Every call creates a NEW task: opening the same
 * directory twice is two parallel sessions in it, so the title gets a random
 * suffix (`rove-af3x`) to tell the rows apart.
 */
export async function openDirectoryTaskRow(deps: StoreDeps, input: OpenDirectoryTaskInput): Promise<Task> {
  if (!input.dir) throw new Error("openDirectoryTask: dir is required")
  const dir = canonPath(input.dir)
  // A scratch shell's home is unsettled by definition, so it mints NO
  // auto-name: title stays empty until the user names it or
  // adoption derives one; every display surface falls back to path/branch.
  return deps.store.create({
    repo: dir,
    title: input.scratch ? "" : `${titleFromRepo(dir)}-${randomDirTaskSuffix()}`,
    branch: "",
    worktreePath: dir,
    status: "backlog",
    kind: "dir",
    ...(input.scratch ? { scratch: true } : {}),
    vendor: input.vendor ?? resolvePreferredVendor(),
  })
}

/**
 * Migrate a scratch task into a repo (adoption): the shell's live cwd landed in
 * `repo` and a coding harness was detected there, so the row earns a project
 * home. Repoints `repo`/`worktreePath` at the repo root and clears the scratch
 * flag — the task becomes an ordinary `kind: "dir"` row grouped under that
 * repo. No-op unless the task is actually a scratch dir task.
 */
export async function adoptScratchRepoRow(deps: StoreDeps, id: TaskId | string, repo: string): Promise<void> {
  const task = deps.store.get(id)
  if (!task || task.kind !== "dir" || task.scratch !== true) return
  const dir = canonPath(repo)
  await deps.store.update(id, { repo: dir, worktreePath: dir, scratch: false, title: titleFromRepo(dir) })
}
