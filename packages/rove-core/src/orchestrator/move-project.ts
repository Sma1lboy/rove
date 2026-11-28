/**
 * `moveTaskToProject`: regroup a top-level task, with its children, under another project. Only the
 * rows change: the PTYs, cwd, worktree and branch stay where they are, so a running engine keeps its
 * conversation. A managed worktree keeps its origin in `gitRepo`, because deleting or landing it
 * is git work in the repo that cut it.
 */

import { isRemoteRepoKey } from "@sma1lboy/rove-core/state/repos.ts"
import { isUngrouped } from "@sma1lboy/rove-core/types/task-scratch.ts"
import type { Task, TaskId } from "@sma1lboy/rove-core/types/task.ts"
import { gitRepoOf, subtreeIds } from "@sma1lboy/rove-daemon/task-tree"
import { normalizeMainRepo, titleFromRepo } from "./core-helpers.ts"
import { MoveRefusedError, TaskDeletingError, TaskNotFoundError } from "./errors.ts"
import type { TaskIndexStore } from "./index/store.ts"

export interface MoveProjectDeps {
  readonly store: TaskIndexStore
  /** Saves the target as a project; returns its normalized repo key. */
  readonly ensureProject: (repo: string) => Promise<string>
}

/** Refusals are decided before the project is saved, so a rejected move leaves nothing behind. */
function refuse(task: Task, targetRepo: string, tasks: readonly Task[]): void {
  if (task.routine) {
    throw new MoveRefusedError(
      "TASK_NOT_MOVABLE",
      `${task.id} is a routine session; the sidebar keeps those in the routine fold`,
    )
  }
  if (task.extraRepos?.length) {
    throw new MoveRefusedError(
      "TASK_NOT_MOVABLE",
      `${task.id} spans several repos; it has no single project to move to`,
    )
  }
  if (isRemoteRepoKey(task.repo) || isRemoteRepoKey(targetRepo)) {
    throw new MoveRefusedError(
      "REMOTE_MOVE_UNSUPPORTED",
      `task ${task.id} or the target lives on a remote project — move it from that machine's rove`,
    )
  }
  if (task.parentTaskId) {
    throw new MoveRefusedError(
      "CHILD_NOT_MOVABLE",
      `${task.id} is a child of ${task.parentTaskId} — move the parent (or \`update --parent none\` first); its children follow it`,
    )
  }
  if (!isUngrouped(task) && normalizeMainRepo(task.repo).key === normalizeMainRepo(targetRepo).key) {
    throw new MoveRefusedError("SAME_PROJECT", `task ${task.id} already belongs to ${task.repo}`)
  }
  for (const id of subtreeIds(tasks, String(task.id))) {
    if (tasks.find((t) => String(t.id) === id)?.deletion) throw new TaskDeletingError(id)
  }
}

export async function moveTaskToProjectRow(
  deps: MoveProjectDeps,
  id: TaskId | string,
  repo: string,
): Promise<{ readonly repo: string; readonly moved: readonly string[] }> {
  const task = deps.store.get(id)
  if (!task) throw new TaskNotFoundError(String(id))
  const tasks = deps.store.list()
  refuse(task, repo, tasks)

  const target = await deps.ensureProject(repo)
  const moved = subtreeIds(tasks, String(task.id))
  for (const rowId of moved) {
    const row = tasks.find((t) => String(t.id) === rowId)
    if (!row) continue
    if (row.kind === "task" && row.worktreePath) {
      // Back to the repo that cut the worktree: the pointer has nothing left to say.
      const origin = gitRepoOf(row)
      const home = normalizeMainRepo(origin).key === normalizeMainRepo(target).key
      await deps.store.update(row.id, { repo: target, gitRepo: home ? undefined : origin })
      continue
    }
    await deps.store.update(row.id, {
      repo: target,
      ...(row.kind === "task" ? { gitRepo: undefined } : {}),
      ...(row.noProject ? { noProject: undefined, title: row.title || titleFromRepo(target) } : {}),
    })
  }
  return { repo: target, moved }
}
