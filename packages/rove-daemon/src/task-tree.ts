/**
 * Task-tree lineage and shared-workspace helpers, pure over task rows. Lives in
 * the daemon package so cwd attribution, deletion and the orchestrator read the
 * same rules.
 */

import type { TaskExtraRepo, TaskPRStatus } from "./daemon/contracts.ts"
import { pathSyntax } from "./path-identity.ts"

/** The slice of a task row these helpers read. */
export interface TreeTask {
  readonly id: string
  readonly parentTaskId?: string
  readonly sharesWorkspaceOf?: string
  readonly worktreePath?: string | null
  readonly cwdSubpath?: string
}

/** Direct children, in list order. */
export function childrenOf<T extends TreeTask>(tasks: readonly T[], id: string): T[] {
  return tasks.filter((task) => task.parentTaskId === id)
}

/** The task whose directory this one runs in: itself unless it shares another's. */
export function workspaceOwnerId(task: TreeTask): string {
  return task.sharesWorkspaceOf ?? task.id
}

export function isSharedChild(task: TreeTask): boolean {
  return task.sharesWorkspaceOf !== undefined
}

/**
 * The top-level task `id` hangs under. A conversation started from a child
 * becomes a sibling of it, so children never nest. A missing ancestor or a
 * cycle stops the walk at the last task seen.
 */
export function lineageRootId(tasks: readonly TreeTask[], id: string): string {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const seen = new Set<string>()
  let current = id
  for (;;) {
    seen.add(current)
    const up = byId.get(current)?.parentTaskId
    if (!up || seen.has(up) || !byId.has(up)) return current
    current = up
  }
}

/** `id` and every descendant, deepest first (a node always follows its children). */
export function subtreeIds(tasks: readonly TreeTask[], id: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const visit = (current: string): void => {
    if (seen.has(current)) return
    seen.add(current)
    for (const child of childrenOf(tasks, current)) visit(child.id)
    out.push(current)
  }
  visit(id)
  return out
}

/** The directory the engine and shells of this task start in. */
export function taskCwd(task: Pick<TreeTask, "worktreePath" | "cwdSubpath">): string {
  const root = task.worktreePath ?? ""
  if (!root || !task.cwdSubpath) return root
  return pathSyntax(root).join(root, task.cwdSubpath)
}

/** Most repos one task may span, primary included. */
export const MULTI_REPO_CAP = 8

/** A repo handle: one path segment, no leading dot (it names a worktree dir and `--base-for` keys). */
export const REPO_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/

/** The slice of a task row the multi-repo helpers read. */
export interface RepoTask extends TreeTask {
  readonly repo: string
  readonly branch: string
  readonly baseRef?: string
  readonly prStatus?: TaskPRStatus
  readonly extraRepos?: readonly TaskExtraRepo[]
}

/** One repo of a task: the primary (the row's own fields) or an extra. */
export interface TaskRepoView {
  readonly name: string
  readonly repo: string
  readonly branch: string
  readonly worktreePath: string
  readonly baseRef?: string
  readonly prStatus?: TaskPRStatus
  readonly primary: boolean
}

/** A repo's handle from its path: the basename made safe for {@link REPO_NAME_RE}. */
export function repoNameOf(repoPath: string): string {
  const base = pathSyntax(repoPath)
    .basename(repoPath)
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/^[.-]+/, "")
  return base || "repo"
}

/** `name`, or `name-2`, `name-3`… the first not in `taken`. */
export function uniqueRepoName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name
  for (let n = 2; ; n++) if (!taken.has(`${name}-${n}`)) return `${name}-${n}`
}

/**
 * Every repo of a task, primary first. A sharer has no extras of its own: with
 * `tasks` it resolves through its workspace owner, as `ensureWorktree` does.
 */
export function taskRepos(task: RepoTask, tasks?: readonly RepoTask[]): TaskRepoView[] {
  const holder = (task.sharesWorkspaceOf && tasks?.find((t) => t.id === task.sharesWorkspaceOf)) || task
  const extras = holder.extraRepos ?? []
  const primaryName = uniqueRepoName(repoNameOf(task.repo), new Set(extras.map((e) => e.name)))
  return [
    {
      name: primaryName,
      repo: task.repo,
      branch: task.branch,
      worktreePath: task.worktreePath ?? "",
      ...(task.baseRef ? { baseRef: task.baseRef } : {}),
      ...(task.prStatus ? { prStatus: task.prStatus } : {}),
      primary: true,
    },
    ...extras.map((e) => ({
      name: e.name,
      repo: e.repo,
      branch: e.branch,
      worktreePath: e.worktreePath,
      ...(e.baseRef ? { baseRef: e.baseRef } : {}),
      ...(e.prStatus ? { prStatus: e.prStatus } : {}),
      primary: false,
    })),
  ]
}

/** Every materialised worktree directory of a task: the primary's, then each extra's. */
export function taskWorktreePaths(task: RepoTask, tasks?: readonly RepoTask[]): string[] {
  return taskRepos(task, tasks)
    .map((r) => r.worktreePath)
    .filter((p) => p.length > 0)
}

/** Lower is worse: the order the rolled-up chip reports. */
function prRank(pr: TaskPRStatus): number {
  if (pr.checkState === "failing") return 0
  if (pr.checkState === "pending") return 1
  return pr.lifecycle === "merged" ? 3 : 2
}

/**
 * The one PR status standing for the whole task: any failing, else any pending,
 * else any not-yet-merged, else merged. Returns that repo's own status, so its
 * number and url ride along. A repo with no PR is ignored; a one-repo task
 * returns its own `prStatus` untouched.
 */
export function rollupPr(task: {
  readonly prStatus?: TaskPRStatus
  readonly extraRepos?: readonly Pick<TaskExtraRepo, "prStatus">[]
}): TaskPRStatus | undefined {
  let worst: TaskPRStatus | undefined
  for (const pr of [task.prStatus, ...(task.extraRepos ?? []).map((e) => e.prStatus)]) {
    if (pr && (!worst || prRank(pr) < prRank(worst))) worst = pr
  }
  return worst
}

/**
 * The repos a per-repo verb acts on: all of them, or the one named `only`.
 * An unknown name throws `UNKNOWN_REPO: …` (the wire code travels in the message).
 */
export function pickRepos(task: RepoTask, only?: string): TaskRepoView[] {
  const all = taskRepos(task)
  if (!only) return all
  const picked = all.filter((r) => r.name === only)
  if (picked.length === 0) {
    throw new Error(`UNKNOWN_REPO: no repo named '${only}' in this task (repos: ${all.map((r) => r.name).join(", ")})`)
  }
  return picked
}
