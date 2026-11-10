/**
 * How a multi-repo task's other worktrees reach an engine or shell. The cwd is
 * always the primary; these are the extras, in three layers: engine-owned
 * `addDirArgv` (applied by the launch builder), this env, and one prompt line.
 */

import type { DaemonRpcClient } from "@sma1lboy/rove-daemon/client/rpc"
import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { type TaskRepoView, taskRepos } from "@sma1lboy/rove-daemon/task-tree"
import type { VendorId } from "../types/vendor.ts"
import { trustEngineWorktree } from "./trust-worktree.ts"

/**
 * The repos a launch for `taskId` exposes, or undefined for a one-repo task.
 * Read from the daemon at launch time: the extras' paths exist only once the
 * worktrees do. A sharer resolves through its workspace owner, which holds them.
 */
export async function launchReposOf(link: DaemonRpcClient, taskId: string): Promise<TaskRepoView[] | undefined> {
  const get = async (id: string) => (await link.request<{ task: SerializedTask }>("task.get", { taskId: id })).task
  const task = await get(taskId)
  const owner = task.sharesWorkspaceOf ? await get(task.sharesWorkspaceOf) : task
  return owner.extraRepos?.length ? taskRepos(owner) : undefined
}

/**
 * The repos a launch exposes: only the materialised ones, and only when that is
 * more than one — a one-repo task (or a sharer of one) launches exactly as before.
 */
export function exposedRepos(repos: readonly TaskRepoView[] | undefined): TaskRepoView[] | undefined {
  const live = (repos ?? []).filter((r) => r.worktreePath.length > 0)
  return live.length > 1 ? live : undefined
}

/**
 * `ROVE_TASK_REPOS` (JSON `[{ name, path, branch, primary }]`) and one
 * `ROVE_REPO_<NAME>` per repo, so `cd "$ROVE_REPO_API"` works. A name is
 * upper-cased to `[A-Z0-9_]`; two names that collapse to one get `_2`, `_3`….
 */
export function repoEnv(repos: readonly TaskRepoView[]): [name: string, value: string][] {
  const exposed = exposedRepos(repos)
  if (!exposed) return []
  const listed = exposed.map((r) => ({ name: r.name, path: r.worktreePath, branch: r.branch, primary: r.primary }))
  const env: [string, string][] = [["ROVE_TASK_REPOS", JSON.stringify(listed)]]
  const used = new Set<string>()
  for (const repo of exposed) {
    const base = `ROVE_REPO_${repo.name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`
    let key = base
    for (let n = 2; used.has(key); n++) key = `${base}_${n}`
    used.add(key)
    env.push([key, repo.worktreePath])
  }
  return env
}

/** The one factual line prepended to a first prompt. */
export function multiRepoNote(repos: readonly TaskRepoView[]): string {
  const primary = repos.find((r) => r.primary)
  const others = repos
    .filter((r) => !r.primary)
    .map((r) => `${r.name} -> ${r.worktreePath} (branch ${r.branch})`)
    .join("; ")
  return `This task spans repos. Primary (cwd): ${primary?.name ?? "?"}. Also checked out: ${others}. $ROVE_TASK_REPOS lists them all.`
}

/** Pre-trust each extra worktree like the primary, or a hosted claude stalls on a dialog nobody can answer. */
export function trustExtraRepos(vendor: VendorId | undefined, repos: readonly TaskRepoView[] | undefined): void {
  for (const repo of repos ?? []) if (!repo.primary) trustEngineWorktree(vendor, repo.worktreePath)
}
