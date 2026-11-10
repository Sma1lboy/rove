/**
 * Multi-repo tasks: validating the picked repos at create, and giving each
 * extra repo its own worktree on the task's shared branch name. The primary
 * stays in the task's own fields and is materialised by `WorktreeCoordinator`;
 * everything here is all-or-nothing around it.
 */

import { MULTI_REPO_CAP, repoNameOf, uniqueRepoName } from "@sma1lboy/rove-daemon/task-tree"
import { isGitRepo, isRemoteRepoKey } from "../state/repos.ts"
import type { Task, TaskExtraRepo } from "../types/task.ts"
import { uniqueBranchName } from "./branch-style.ts"
import { canonPath, normalizeMainRepo } from "./core-helpers.ts"
import { ExtraRepoNotGitError, RemoteExtraUnsupportedError, RepoDuplicateError, TooManyReposError } from "./errors.ts"
import type { WorkspaceBackend } from "./workspace/types.ts"
import type { GitWorktreeManager } from "./worktree/manager.ts"
import type { SlugAllocator } from "./worktree/slug-allocator.ts"

/** One extra repo as the caller picked it. */
export interface ExtraRepoInput {
  readonly repo: string
  readonly baseRef?: string
}

/**
 * The picked extras as stored rows: each resolved to its git root, named, in
 * pick order. Refuses what a task cannot span (remote repos, non-git paths,
 * the same root twice, more than {@link MULTI_REPO_CAP} in all).
 */
export function planExtraRepos(primary: string, inputs: readonly ExtraRepoInput[]): TaskExtraRepo[] {
  if (inputs.length === 0) return []
  if (1 + inputs.length > MULTI_REPO_CAP) throw new TooManyReposError(1 + inputs.length, MULTI_REPO_CAP)
  if (isRemoteRepoKey(primary)) throw new RemoteExtraUnsupportedError(primary)
  const seen = new Set([canonPath(primary)])
  const names = new Set([repoNameOf(primary)])
  return inputs.map((input) => {
    if (isRemoteRepoKey(input.repo)) throw new RemoteExtraUnsupportedError(input.repo)
    const { repo } = normalizeMainRepo(input.repo)
    if (!isGitRepo(repo)) throw new ExtraRepoNotGitError(input.repo)
    if (seen.has(canonPath(repo))) throw new RepoDuplicateError(repo)
    seen.add(canonPath(repo))
    const name = uniqueRepoName(repoNameOf(repo), names)
    names.add(name)
    const baseRef = input.baseRef?.trim()
    return { name, repo, branch: "", worktreePath: "", ...(baseRef ? { baseRef } : {}) }
  })
}

/** A worktree this call created, with what undoing it must also delete. */
export interface CreatedWorktree {
  readonly path: string
  /** Set when the branch was cut for this checkout alone, so it goes with it. */
  readonly fresh?: { readonly repo: string; readonly branch: string }
}

/**
 * Remove a worktree this call just created. `force`: a brand-new checkout holds
 * no user work. Logged, not thrown, so the caller's real error isn't masked.
 */
export async function rollbackWorktree(backend: WorkspaceBackend, created: CreatedWorktree): Promise<void> {
  try {
    await backend.dispose(
      { path: created.path, ...created.fresh },
      created.fresh ? { force: true, deleteBranch: true } : { force: true },
    )
  } catch (err) {
    console.error(`[rove] ensureWorktree rollback failed for ${created.path}:`, err)
  }
}

/** Extras with no checkout on disk: never created, or the directory vanished. */
export async function extrasToMaterialise(
  worktrees: GitWorktreeManager,
  extras: readonly TaskExtraRepo[] | undefined,
): Promise<TaskExtraRepo[]> {
  const missing: TaskExtraRepo[] = []
  for (const extra of extras ?? []) {
    if (!extra.worktreePath || !(await worktrees.pathExists(extra.worktreePath))) missing.push(extra)
  }
  return missing
}

/** Whole percents of step `step` (0-based) out of `total` equal steps, as one 0-100 stream. */
export function scaleProgress(
  onProgress: ((percent: number) => void) | undefined,
  step: number,
  total: number,
): ((percent: number) => void) | undefined {
  return onProgress && ((percent) => onProgress(Math.floor(((step + percent / 100) / total) * 100)))
}

export interface MaterialisedExtras {
  /** The task's full extras list with the new paths and branches filled in. */
  readonly extraRepos: TaskExtraRepo[]
  readonly created: readonly CreatedWorktree[]
  /** The slugs picked for the new checkouts, to commit once the row is persisted or cancel on failure. */
  readonly slugs: readonly { readonly repo: string; readonly slug: string }[]
}

export interface MaterialiseExtrasOpts {
  readonly worktrees: GitWorktreeManager
  /** Creates and (on failure) removes each extra; extras are always plain git worktrees. */
  readonly backend: WorkspaceBackend
  readonly slugs: SlugAllocator
  readonly task: Task
  /** The branch the primary was cut on (or already holds). */
  readonly branch: string
  /** `onProgress` for step `n` of this call's checkouts. */
  readonly progressFor: (extraIndex: number) => ((percent: number) => void) | undefined
}

/**
 * Create the missing extras, in order. An extra with a recorded branch gets that
 * branch back (its commits survive the vanished directory). Otherwise it gets
 * the shared name, suffixed in that repo only when the name is taken there — a
 * caller-named branch (`task.branch` set at create) is reused like the primary
 * reuses an existing one. A failure undoes every extra created here before
 * rethrowing; the caller owns the primary.
 */
export async function materialiseExtras(opts: MaterialiseExtrasOpts): Promise<MaterialisedExtras> {
  const { worktrees, backend, slugs, task } = opts
  const callerNamed = task.branch !== ""
  const created: CreatedWorktree[] = []
  const picked: { repo: string; slug: string }[] = []
  const done = new Map<string, TaskExtraRepo>()
  const missing = await extrasToMaterialise(worktrees, task.extraRepos)
  try {
    for (const [index, extra] of missing.entries()) {
      // A stale registration of a vanished directory makes `worktree add` on a new path fail.
      if (extra.worktreePath) await worktrees.pruneWorktrees(extra.repo)
      const names = await worktrees.listBranchNames(extra.repo)
      const branch =
        extra.branch ||
        (callerNamed || !names.includes(opts.branch)
          ? opts.branch
          : uniqueBranchName(opts.branch, new Set(names), task.id))
      const slug = await slugs.allocate(extra.repo)
      picked.push({ repo: extra.repo, slug })
      const info = await backend.materialize({
        repo: extra.repo,
        slug,
        branch,
        baseRef: extra.baseRef,
        onProgress: opts.progressFor(index),
      })
      created.push({
        path: info.path,
        ...(names.includes(branch) ? {} : { fresh: { repo: extra.repo, branch } }),
      })
      done.set(extra.name, { ...extra, branch, worktreePath: info.path })
    }
  } catch (err) {
    for (const wt of created.reverse()) await rollbackWorktree(backend, wt)
    for (const { repo, slug } of picked) slugs.cancel(repo, slug)
    throw err
  }
  return {
    extraRepos: (task.extraRepos ?? []).map((e) => done.get(e.name) ?? e),
    created,
    slugs: picked,
  }
}
