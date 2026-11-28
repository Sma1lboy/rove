/**
 * Minting task rows: repo-backed (lazy worktree), standalone directory
 * (`rove .`, No folder). Takes the store, not the
 * Orchestrator, so the Orchestrator stays a thin delegator.
 */

import { PLACEHOLDER_TASK_TITLE, sanitizeTaskTitle } from "@sma1lboy/rove-core/orchestrator/title.ts"
import { isRemoteRepoKey } from "@sma1lboy/rove-core/state/repos.ts"
import { resolvePreferredVendor } from "@sma1lboy/rove-core/state/vendor-prefs.ts"
import type { Task, TaskId, TaskRoutineLink, VendorId } from "@sma1lboy/rove-core/types/task.ts"
import { DEFAULT_TASK_VENDOR, toTaskId } from "@sma1lboy/rove-core/types/task.ts"
import { lineageRootId } from "@sma1lboy/rove-daemon/task-tree"
import type { TaskWorkspace } from "@sma1lboy/rove-daemon/workspace"
import { canonPath, normalizeMainRepo, randomDirTaskSuffix, repoWorkingDir, titleFromRepo } from "./core-helpers.ts"
import type { CreateTaskInput } from "./create-task-input.ts"
import { RemoteParentUnsupportedError, TaskDeletingError, TaskNotFoundError } from "./errors.ts"
import type { TaskIndexStore } from "./index/store.ts"
import { planExtraRepos } from "./multi-repo.ts"
import type { ProjectCoordinator } from "./projects.ts"

/** The store alone — all a directory/scratch row needs. */
export interface StoreDeps {
  readonly store: TaskIndexStore
}

/** Plus the project-row coordinator, for a repo-backed task. */
export interface CreateDeps extends StoreDeps {
  readonly projects: ProjectCoordinator
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
  /** Ungrouped (a No folder session, a projectless routine's run): stays there until an explicit move. */
  readonly noProject?: boolean
  /** Explicit title; absent mints `<dir>-<suffix>` (noProject: empty, so it shows its path). */
  readonly title?: string
  readonly model?: string
  readonly modelEffort?: string
  /** Standing session of a routine, folded behind its group's routine row. */
  readonly routine?: TaskRoutineLink
  /** The backend that owns `dir`; absent = the user's own directory (`borrowed`). */
  readonly workspace?: TaskWorkspace
}

/** The stored parent of a child nested under `id`: its top-level ancestor, since children never nest. */
function nestingParent(store: TaskIndexStore, id: string): TaskId {
  const parent = store.get(id)
  if (!parent) throw new TaskNotFoundError(id)
  if (parent.deletion) throw new TaskDeletingError(String(parent.id))
  if (isRemoteRepoKey(parent.repo)) throw new RemoteParentUnsupportedError(String(parent.id))
  return toTaskId(lineageRootId(store.list(), parent.id))
}

/**
 * Create a new task entry. Worktree allocation is lazy — the `worktreePath`
 * field stays empty until `ensureWorktree` is called (typically when the user
 * enters the task for the first time).
 */
export async function createTaskRow(deps: CreateDeps, input: CreateTaskInput): Promise<Task> {
  if (!input.repo) throw new Error("createTask: repo is required")
  // Refused before the project is saved: a rejected multi-repo create leaves nothing behind.
  const extraRepos = planExtraRepos(normalizeMainRepo(input.repo).repo, input.extraRepos ?? [])
  const parentTaskId = input.parentTaskId ? nestingParent(deps.store, input.parentTaskId) : undefined
  // Save the project only if the repo may BE a project
  // (state/project-eligibility.ts). An ineligible one (`/tmp` fixture,
  // `.dev-sandbox`) still gets its task; `buildTreeRows` renders it under a
  // header that dies with it.
  //
  // Always normalize to the git toplevel (via `normalizeMainRepo`, so it works
  // for an unsaved repo): a SUBDIRECTORY passes `validateRepoPath` and would
  // otherwise become a ghost project with its own worktree root. Dir/scratch
  // tasks don't come through here.
  const repo =
    deps.projects.ensureIfEligible(input.repo, input.projectIntent ?? "explicit") ?? normalizeMainRepo(input.repo).repo
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
    ...(parentTaskId ? { parentTaskId } : {}),
    ...(input.worktreeOnly ? { worktreeOnly: true } : {}),
    ...(input.cwdSubpath ? { cwdSubpath: input.cwdSubpath } : {}),
    ...(input.routine ? { routine: input.routine } : {}),
    // Persisted ON the task: `ensureWorktree` may run in a later daemon
    // process, and `collect` compares against this recorded fork point.
    ...(input.baseRef?.trim() ? { baseRef: input.baseRef.trim() } : {}),
    ...(extraRepos.length > 0 ? { extraRepos } : {}),
    ...(input.workspace ? { workspace: input.workspace } : {}),
    // Same: allocated lazily, and the caller was already told the path.
    ...(worktreeName ? { worktreeName } : {}),
  })
  return task
}

/**
 * Open a directory as a `kind: "dir"` task (`rove .`, a session in a project's
 * own checkout): no worktree or branch; deletion only drops the index entry.
 * Every call is a NEW parallel session, hence the random title suffix (`rove-af3x`).
 */
export async function openDirectoryTaskRow(deps: StoreDeps, input: OpenDirectoryTaskInput): Promise<Task> {
  if (!input.dir) throw new Error("openDirectoryTask: dir is required")
  // A remote project's key is `ssh://…`; its sessions run in the remote base path.
  const remote = isRemoteRepoKey(input.dir)
  const dir = remote ? input.dir : canonPath(input.dir)
  const explicitTitle = input.title ? sanitizeTaskTitle(input.title) : ""
  // No folder mints no name; displays fall back to path/branch until auto-title or a rename names it.
  const title = explicitTitle || (input.noProject ? "" : `${titleFromRepo(dir)}-${randomDirTaskSuffix()}`)
  return deps.store.create({
    repo: dir,
    title,
    branch: "",
    worktreePath: remote ? repoWorkingDir(dir) : dir,
    status: "backlog",
    kind: "dir",
    ...(input.noProject ? { noProject: true } : {}),
    ...(input.routine ? { routine: input.routine } : {}),
    ...(input.workspace ? { workspace: input.workspace } : {}),
    ...(input.modelEffort ? { modelEffort: input.modelEffort } : {}),
    ...(input.model?.trim() ? { model: input.model.trim() } : {}),
    vendor: input.vendor ?? resolvePreferredVendor(),
  })
}
