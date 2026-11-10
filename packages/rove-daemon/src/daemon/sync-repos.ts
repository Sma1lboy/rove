/**
 * `task.syncBase` for a task that spans several repos: merge each repo's own
 * base into its own worktree. A conflict in one repo leaves that merge in place
 * (by design, as for one repo) and does not stop the others.
 */

import { type RepoTask, pickRepos } from "../task-tree.ts"
import type { SyncRepoResult, SyncReposResult } from "./contracts.ts"
import type { DaemonRuntimeAdapter } from "./runtime.ts"

export async function syncRepos(
  runtime: Pick<DaemonRuntimeAdapter, "syncWorktreeWithBase">,
  task: RepoTask,
  only?: string,
): Promise<SyncReposResult> {
  const repos: SyncRepoResult[] = []
  for (const repo of pickRepos(task, only)) {
    if (!repo.worktreePath) {
      repos.push({ name: repo.name, ok: false, error: "no worktree to sync" })
      continue
    }
    try {
      const res = await runtime.syncWorktreeWithBase(repo.worktreePath, repo.baseRef)
      repos.push({ name: repo.name, ok: true, baseRef: res.baseRef, alreadyCurrent: res.alreadyCurrent })
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      const code = /^([A-Z][A-Z0-9_]{2,}): /.exec(error)?.[1]
      repos.push({ name: repo.name, ok: false, error, ...(code ? { code } : {}) })
    }
  }
  const synced = repos.find((r) => r.ok)
  return {
    baseRef: synced?.baseRef ?? "",
    alreadyCurrent: repos.every((r) => r.ok && r.alreadyCurrent === true),
    repos,
  }
}
