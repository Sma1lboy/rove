/**
 * `forkTaskRow`: a sibling task whose worktree is a copy-on-write clone of an existing task's, so it starts with
 * the parent's uncommitted, staged and ignored files (`add --fork`, the TUI/web quick-fork). Takes its
 * collaborators, not the Orchestrator.
 */

import { isRemoteRepoKey } from "../state/repos.ts"
import type { Task, TaskId } from "../types/task.ts"
import type { CreateTaskInput } from "./create-task-input.ts"
import { ForkUnsupportedError, TaskDeletingError, TaskNotFoundError } from "./errors.ts"
import type { TaskIndexStore } from "./index/store.ts"
import { type WorkspaceRegistry, workspaceBackendId, workspaceCapabilities } from "./workspace/index.ts"
import { git } from "./worktree/git.ts"

export interface ForkTaskDeps {
  readonly store: TaskIndexStore
  readonly createRow: (input: CreateTaskInput) => Promise<Task>
  /** Materialises a managed task's worktree (a sharer resolves to its owner's). */
  readonly ensureWorktree: (id: TaskId) => Promise<string>
  /** Materialises `child` as a clone of `parentPath`. */
  readonly cloneInto: (child: Task, parentPath: string) => Promise<string>
  readonly workspaces: Pick<WorkspaceRegistry, "get">
}

export async function forkTaskRow(
  deps: ForkTaskDeps,
  input: CreateTaskInput & { readonly forkFrom: TaskId },
): Promise<Task> {
  const parent = deps.store.get(input.forkFrom)
  if (!parent) throw new TaskNotFoundError(input.forkFrom)
  if (parent.deletion) throw new TaskDeletingError(String(parent.id))
  if (!workspaceCapabilities(parent).ownsDirectory) {
    throw new ForkUnsupportedError("a main or directory task has no Rove-created worktree to clone")
  }
  if (isRemoteRepoKey(parent.repo)) throw new ForkUnsupportedError("a remote project's worktree cannot be cloned")
  if (parent.extraRepos?.length) {
    throw new ForkUnsupportedError("a multi-repo task cannot be forked: only its primary repo would be cloned")
  }

  // Materialise a still-lazy parent first: forking it then clones a clean checkout, which is its true state.
  const parentPath = await deps.ensureWorktree(parent.id)
  // The clone starts at the parent's HEAD, whatever base the caller asked for.
  const baseRef = git(["rev-parse", "HEAD"], { cwd: parentPath, readOnly: true }).stdout.trim()
  const child = await deps.createRow({
    ...input,
    repo: parent.repo,
    title: input.title ?? `${parent.title} (fork)`,
    baseRef,
    workspace: { backend: "cow-clone", ref: String(parent.id) },
    ...(parent.cwdSubpath ? { cwdSubpath: parent.cwdSubpath } : {}),
  })
  // Eager: the copy must capture the parent as it is now, not at the child's first enter.
  try {
    await deps.cloneInto(child, parentPath)
  } catch (err) {
    await discard(deps, child).catch((cleanup) =>
      console.error(`[rove] fork rollback failed for ${child.id}:`, cleanup),
    )
    await deps.store.remove(child.id)
    throw err
  }
  return deps.store.get(child.id) ?? child
}

/** Removes whatever worktree and branch the row picked up, force: a failed fork holds no user work. */
async function discard(deps: ForkTaskDeps, child: Task): Promise<void> {
  const row = deps.store.get(child.id)
  if (!row?.worktreePath) return
  await deps.workspaces
    .get(workspaceBackendId(row))
    .dispose({ path: row.worktreePath, repo: row.repo, branch: row.branch }, { force: true, deleteBranch: true })
}
