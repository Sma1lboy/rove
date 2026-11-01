/**
 * The {@link Orchestrator}'s on-disk worktree side: slug allocation, lazy
 * materialise, adoption, and the locks that keep them race- and delete-safe.
 *   - **Lazy allocation.** `createTask` records intent (empty `worktreePath`);
 *     {@link ensure} materialises on first enter.
 *   - **Dedupe + delete-safety.** {@link ensure} / {@link adopt} share the
 *     in-flight promise, so a concurrent caller reads the created path instead
 *     of re-reading the store (which throws if a delete landed meanwhile).
 *   - **Self-cleaning rollback.** {@link createWorktree} commits the slug ONLY
 *     after the store write; any partial failure removes the worktree and
 *     frees the slug.
 */

import { basename } from "node:path"
import { samePath } from "@sma1lboy/rove-daemon/path-identity"
import type { Task, TaskId, VendorId } from "../types/task.ts"
import { DEFAULT_TASK_VENDOR } from "../types/task.ts"
import type { AdoptableWorktree } from "../types/worktree.ts"
import { deriveConventionBranch, inferBranchStyle, uniqueBranchName } from "./branch-style.ts"
import { ForkUnsupportedError, InvalidWorktreeNameError } from "./errors.ts"
import type { TaskIndexStore } from "./index/store.ts"
import {
  type MaterialisedExtras,
  extrasToMaterialise,
  materialiseExtras,
  rollbackWorktree,
  scaleProgress,
} from "./multi-repo.ts"
import { taskWorktreePaths } from "./task-tree.ts"
import { PLACEHOLDER_TASK_TITLE } from "./title.ts"
import { type WorkspaceRegistry, workspaceBackendId } from "./workspace/index.ts"
import type { GitWorktreeManager } from "./worktree/manager.ts"
import { SlugAllocator } from "./worktree/slug-allocator.ts"

/** One path segment, no `..`, no leading dot: all worktree cleanup is scoped
 *  to the repo's worktree root. */
const WORKTREE_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/

/** Injected so the Orchestrator and this dedupe identically. */
type CanonPath = (p: string) => string

/** Ensures the repo's main row; called INSIDE the adopt lock. */
type EnsureProject = (repo: string) => Promise<unknown>

export interface AdoptWorktreeInput {
  readonly repo: string
  readonly worktreePath: string
  readonly branch?: string
  readonly vendor?: VendorId
  readonly title?: string
  readonly ifExists?: "error" | "return"
}

export class WorktreeCoordinator {
  private readonly store: TaskIndexStore
  private readonly worktrees: GitWorktreeManager
  private readonly workspaces: WorkspaceRegistry
  private readonly canonPath: CanonPath
  private readonly ensureProject: EnsureProject
  private readonly slugs: SlugAllocator
  /** Resolves to the created path so waiters needn't re-fetch the task (which
   *  throws {@link TaskNotFoundError} if a delete landed meanwhile). */
  private readonly worktreeLocks = new Map<TaskId, { readonly work: Promise<string>; readonly forked: boolean }>()
  /** Keyed by canonical worktree path. */
  private readonly adoptLocks = new Map<string, Promise<Task>>()
  /**
   * Auto branch names being materialised. Convention names have no random
   * suffix, so same-titled siblings in a parallel round would both derive one
   * name and git's taken-set can't see it yet. Released after the git call
   * either way (on success the branch itself guards).
   */
  private readonly reservedBranches = new Set<string>()

  constructor(
    store: TaskIndexStore,
    worktrees: GitWorktreeManager,
    workspaces: WorkspaceRegistry,
    canonPath: CanonPath,
    ensureProject: EnsureProject,
  ) {
    this.store = store
    this.worktrees = worktrees
    this.workspaces = workspaces
    this.canonPath = canonPath
    this.ensureProject = ensureProject
    // A task's extras occupy slugs in THEIR repo's worktree root, not the primary's.
    this.slugs = new SlugAllocator((repo) =>
      this.store
        .list()
        .filter((t) => t.kind !== "main")
        .flatMap((t) => [
          ...(samePath(t.repo, repo) ? [t.worktreePath] : []),
          ...(t.extraRepos ?? []).filter((x) => samePath(x.repo, repo)).map((x) => x.worktreePath),
        ])
        .map((path) => path.match(/([^/\\]+)[/\\]*$/)?.[1] ?? "")
        .filter((s) => s.length > 0),
    )
  }

  /**
   * At CREATE time, so `add --worktree-name` fails while the caller is looking
   * (a collision on first enter would strand a task row). Held pending until
   * the worktree commits, so two concurrent creates can't both take it.
   */
  async claimWorktreeName(repo: string, name: string): Promise<string> {
    if (!WORKTREE_NAME_RE.test(name)) throw new InvalidWorktreeNameError(name)
    return await this.slugs.claim(repo, name)
  }

  forget(id: TaskId): void {
    this.worktreeLocks.delete(id)
  }

  /** `task` is already known unmaterialised (the Orchestrator short-circuits
   *  the rest). Idempotent + delete-safe via {@link worktreeLocks}. `forkFrom`: the
   *  parent worktree a `cow-clone` task clones, passed by the one caller forking it
   *  right now; any later materialisation gets none and cuts a plain worktree. */
  async ensure(task: Task, onProgress?: (percent: number) => void, forkFrom?: string): Promise<string> {
    const inflight = this.worktreeLocks.get(task.id)
    if (inflight) {
      // A plain enter got there first: handing its worktree to a fork would silently drop the clone.
      if (forkFrom && !inflight.forked) {
        await inflight.work.catch(() => {})
        throw new ForkUnsupportedError("the task was entered before its clone was made")
      }
      return inflight.work
    }
    const work = this.createWorktree(task, onProgress, forkFrom)
    this.worktreeLocks.set(task.id, { work, forked: forkFrom !== undefined })
    try {
      return await work
    } finally {
      this.worktreeLocks.delete(task.id)
    }
  }

  /**
   * Slug → worktree → persist, retry-safe: every partial failure rolls back so
   * no orphan (worktree + committed slug + empty `worktreePath`, needing a
   * manual `rm`) is left. The slug commits ONLY after `store.update` succeeds.
   * A multi-repo task materialises its extras after the primary and persists
   * once, so any failure removes every checkout this call created. A primary
   * that already exists is left alone: only missing extras are created.
   * Returns the path directly so a delete right after creation can't turn
   * success into a spurious {@link TaskNotFoundError}.
   */
  private async createWorktree(task: Task, onProgress?: (percent: number) => void, forkFrom?: string): Promise<string> {
    const extrasMissing = await extrasToMaterialise(this.worktrees, task.extraRepos)
    if (task.worktreePath && extrasMissing.length === 0) return task.worktreePath
    const total = (task.worktreePath ? 0 : 1) + extrasMissing.length
    const primary = task.worktreePath
      ? undefined
      : await this.createPrimary(task, scaleProgress(onProgress, 0, total), forkFrom)
    const branch = primary?.branch ?? task.branch
    const undoPrimary = async (): Promise<void> => {
      if (!primary) return
      await rollbackWorktree(this.workspaces.get(workspaceBackendId(task)), {
        path: primary.path,
        ...(primary.fresh ? { fresh: { repo: task.repo, branch } } : {}),
      })
      this.slugs.cancel(task.repo, primary.slug)
    }
    let extras: MaterialisedExtras | undefined
    try {
      if (extrasMissing.length > 0) {
        extras = await materialiseExtras({
          worktrees: this.worktrees,
          backend: this.workspaces.get("git-worktree"),
          slugs: this.slugs,
          task,
          branch,
          progressFor: (i) => scaleProgress(onProgress, (primary ? 1 : 0) + i, total),
        })
      }
    } catch (err) {
      await undoPrimary()
      throw err
    }
    // If this write fails (or a concurrent delete saw an empty `worktreePath`
    // and skipped cleanup), roll back ourselves or it's invisible debris.
    try {
      await this.store.update(task.id, {
        ...(primary ? { worktreePath: primary.path, branch } : {}),
        ...(extras ? { extraRepos: extras.extraRepos } : {}),
      })
    } catch (err) {
      for (const wt of [...(extras?.created ?? [])].reverse()) {
        await rollbackWorktree(this.workspaces.get("git-worktree"), wt)
      }
      for (const { repo, slug } of extras?.slugs ?? []) this.slugs.cancel(repo, slug)
      await undoPrimary()
      throw err
    }
    if (primary) this.slugs.commit(task.repo, primary.slug)
    for (const { repo, slug } of extras?.slugs ?? []) this.slugs.commit(repo, slug)
    return primary?.path ?? task.worktreePath
  }

  /** The primary checkout: slug, branch (derived when the task named none), `worktree add`. Not yet persisted. */
  private async createPrimary(
    task: Task,
    onProgress?: (percent: number) => void,
    forkFrom?: string,
  ): Promise<{ path: string; branch: string; slug: string; fresh: boolean }> {
    // Already claimed at create time; re-claiming would refuse its own
    // pending reservation.
    const slug = task.worktreeName || (await this.slugs.allocate(task.repo))
    const branch = task.branch || (await this.deriveAutoBranch(task))
    // `add --base-branch`, persisted at create so it survives a daemon restart
    // before materialise. Absent on older records → git default.
    const baseRef = task.baseRef
    try {
      // Read before the add: a branch that exists now was not cut by this call, so a rollback must keep it.
      const fresh = !(await this.worktrees.listBranchNames(task.repo)).includes(branch)
      const handle = await this.workspaces
        .get(workspaceBackendId(task))
        .materialize({ repo: task.repo, slug, branch, baseRef, onProgress, forkFrom })
      return { path: handle.path, branch, slug, fresh }
    } catch (err) {
      this.slugs.cancel(task.repo, slug)
      throw err
    } finally {
      this.reservedBranches.delete(branch)
    }
  }

  /**
   * Apply the repo's inferred naming convention (local + origin branches) to
   * the title; `-2`/`-3` against existing and in-flight reserved names. Never a
   * rove/rove brand token; unreadable/empty repo → bare kebab slug.
   */
  private async deriveAutoBranch(task: Task): Promise<string> {
    const names = await this.worktrees.listBranchNames(task.repo)
    const base = deriveConventionBranch(task.title, inferBranchStyle(names), task.id)
    const taken = new Set([...names, ...this.reservedBranches])
    const branch = uniqueBranchName(base, taken, task.id)
    this.reservedBranches.add(branch)
    return branch
  }

  /** Worktrees not linked to any task (by canonical path), including ones
   *  outside the convention root (the user's own `git worktree add`). */
  async discoverAdoptable(repo: string): Promise<readonly AdoptableWorktree[]> {
    const all = await this.worktrees.listAll(repo)
    const linked = new Set(
      this.store
        .list()
        .flatMap((t) => taskWorktreePaths(t))
        .map((p) => this.canonPath(p)),
    )
    return all.filter((wt) => !linked.has(this.canonPath(wt.path)))
  }

  /** Serialized per path ({@link adoptLocks}) so two WorktreeCreate hooks for
   *  one path can't both pass the "already a task?" check. Inputs are
   *  validated by the caller. */
  async adopt(input: AdoptWorktreeInput): Promise<Task> {
    const target = this.canonPath(input.worktreePath)
    const inflight = this.adoptLocks.get(target)
    if (inflight) return inflight
    const work = this.adoptLocked(input, target)
    this.adoptLocks.set(target, work)
    try {
      return await work
    } finally {
      this.adoptLocks.delete(target)
    }
  }

  private async adoptLocked(input: AdoptWorktreeInput, target: string): Promise<Task> {
    // Sharers sit on the same path: answer with the owner, never a child.
    const holders = this.store.list().filter((t) => taskWorktreePaths(t).some((p) => this.canonPath(p) === target))
    const existing = holders.find((t) => !t.sharesWorkspaceOf) ?? holders[0]
    if (existing) {
      if (input.ifExists === "return") return existing
      throw new Error(`adoptWorktree: ${input.worktreePath} is already adopted as a task`)
    }
    // Not `listAll`: it runs git status + log per worktree we'd discard.
    const candidates = await this.worktrees.listAdoptablePaths(input.repo)
    const match = candidates.find((wt) => this.canonPath(wt.path) === target)
    if (!match) {
      throw new Error(
        `adoptWorktree: ${input.worktreePath} is not an adoptable git worktree of ${input.repo} (unknown, detached, or the main checkout)`,
      )
    }
    const branch = input.branch?.trim() || match.branch
    const title = (input.title ?? basename(match.path)).trim() || PLACEHOLDER_TASK_TITLE
    // Like createTask: brings the project's main row into existence.
    await this.ensureProject(input.repo)
    return this.store.create({
      repo: input.repo,
      title,
      branch,
      worktreePath: match.path,
      status: "backlog",
      kind: "task",
      vendor: input.vendor ?? DEFAULT_TASK_VENDOR,
    })
  }
}
