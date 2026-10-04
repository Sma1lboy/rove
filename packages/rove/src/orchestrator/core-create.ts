/**
 * Minting task rows: repo-backed (lazy worktree), standalone directory
 * (`rove .`), and scratch-shell adoption. Takes the store, not the
 * Orchestrator, so the Orchestrator stays a thin delegator.
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
  /**
   * Claim a caller-chosen worktree directory name, or throw (the slug
   * allocator's check). Called BEFORE the row is written, so a collision never
   * leaves a task that can't materialise where its caller was told.
   */
  readonly claimWorktreeName: (repo: string, name: string) => Promise<string>
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
  // Ensure the project row only if the repo may BE a project
  // (state/project-eligibility.ts). An ineligible one (`/tmp` fixture,
  // `.dev-sandbox`) still gets its task; `buildTreeRows` renders it under a
  // header that dies with it.
  //
  // Always normalize to the git toplevel (via `normalizeMainRepo`, so it works
  // with no main row): a SUBDIRECTORY passes `validateRepoPath` and would
  // otherwise become a ghost project with its own worktree root. Dir/scratch
  // tasks don't come through here.
  const mainTask = await deps.mainTasks.ensureIfEligible(input.repo, input.projectIntent ?? "explicit")
  const repo = mainTask?.repo ?? normalizeMainRepo(input.repo).repo
  const title = sanitizeTaskTitle(input.title ?? PLACEHOLDER_TASK_TITLE) || PLACEHOLDER_TASK_TITLE
  // Against the NORMALIZED repo — the key the allocator's occupied set uses.
  const worktreeName = input.worktreeName?.trim()
  if (worktreeName) await deps.claimWorktreeName(repo, worktreeName)
  // Branch stays EMPTY unless given: {@link ensureWorktree} derives it at
  // materialise time against the live branch list, and so it can follow a
  // rename made before first enter.
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
    ...(input.model?.trim() ? { model: input.model.trim() } : {}),
    ...(input.tier?.trim() ? { tier: input.tier.trim() } : {}),
    ...(input.groupId ? { groupId: input.groupId } : {}),
    ...(input.dispatcher ? { dispatcher: input.dispatcher } : {}),
    ...(input.routine ? { routine: input.routine } : {}),
    // Persisted ON the task: `ensureWorktree` may run in a later daemon
    // process, and `collect` compares against this recorded fork point.
    ...(input.baseRef?.trim() ? { baseRef: input.baseRef.trim() } : {}),
    // Same: allocated lazily, and the caller was already told the path.
    ...(worktreeName ? { worktreeName } : {}),
  })
  return task
}

/**
 * Open a directory as a standalone `kind: "dir"` task (`rove .`): no main
 * task, worktree or branch; deletion only drops the index entry. Every call is
 * a NEW parallel session, hence the random title suffix (`rove-af3x`).
 */
export async function openDirectoryTaskRow(deps: StoreDeps, input: OpenDirectoryTaskInput): Promise<Task> {
  if (!input.dir) throw new Error("openDirectoryTask: dir is required")
  const dir = canonPath(input.dir)
  // Scratch mints no name (its home is unsettled); displays fall back to path/branch.
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
 * Adopt a scratch task into `repo` (its shell's cwd landed there and a coding
 * harness was detected): it becomes an ordinary `dir` row under that repo.
 * No-op unless it is a scratch dir task.
 */
export async function adoptScratchRepoRow(deps: StoreDeps, id: TaskId | string, repo: string): Promise<void> {
  const task = deps.store.get(id)
  if (!task || task.kind !== "dir" || task.scratch !== true) return
  const dir = canonPath(repo)
  await deps.store.update(id, { repo: dir, worktreePath: dir, scratch: false, title: titleFromRepo(dir) })
}
