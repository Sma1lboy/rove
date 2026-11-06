/** `Orchestrator.landTask` past its checks: one repo lands through `land.ts`, several through `land-multi.ts`. */

import type { Task, TaskId } from "../types/task.ts"
import { canonPath } from "./core-helpers.ts"
import { landTaskAll } from "./land-multi.ts"
import { type LandResult, type LandTaskOpts, landTaskWithCleanup } from "./land.ts"
import { pickRepos } from "./task-tree.ts"
import type { GitWorktreeManager } from "./worktree/manager.ts"

export interface LandRoutedDeps {
  list(): readonly Task[]
  readonly worktrees: GitWorktreeManager
  readonly tearDownSession?: (taskId: TaskId | string) => Promise<void>
  clearWorktreePath(id: TaskId | string): Promise<void>
  clearRepoWorktreePath(id: TaskId | string, repoName: string): Promise<void>
}

export async function landRouted(task: Task, opts: LandTaskOpts, deps: LandRoutedDeps): Promise<LandResult> {
  pickRepos(task, opts.repo)
  // Sharers keep running in the directory a land would unlink.
  const sharing = (landed: Task, path: string): boolean =>
    deps
      .list()
      .some(
        (t) =>
          t.id !== landed.id &&
          ((t.worktreePath && canonPath(t.worktreePath) === canonPath(path)) || t.sharesWorkspaceOf === landed.id),
      )
  if (task.extraRepos?.length) {
    return landTaskAll(
      task,
      opts,
      {
        worktrees: deps.worktrees,
        tearDownSession: deps.tearDownSession,
        clearRepoWorktreePath: (tid, name) => deps.clearRepoWorktreePath(tid, name),
        sharesRepoWorktree: (landed, repo) => sharing(landed, repo.worktreePath),
      },
      opts.repo,
    )
  }
  return landTaskWithCleanup(task, opts, {
    worktrees: deps.worktrees,
    clearWorktreePath: (tid) => deps.clearWorktreePath(tid),
    tearDownSession: deps.tearDownSession,
    sharesWorktree: (landed) => sharing(landed, landed.worktreePath),
  })
}
