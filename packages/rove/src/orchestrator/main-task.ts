/**
 * `kind:"main"` row lifecycle for the {@link Orchestrator}: create, adopt a
 * dir session on the same root, forget. A main row is the sidebar's PROJECTS
 * entry — the repo root itself, no `git worktree add`. Shared invariant: the
 * canonical main-repo key.
 */

import { type ProjectIntent, projectRejection, rejectionReason } from "../state/project-eligibility.ts"
import { addSavedRepo, getSavedRepos, isGitRepo, removeSavedRepo } from "../state/repos.ts"
import { resolvePreferredVendor } from "../state/vendor-prefs.ts"
import type { Task, TaskId } from "../types/task.ts"
import { normalizeMainRepo, repoWorkingDir, titleFromRepo } from "./core-helpers.ts"
import type { TaskIndexStore } from "./index/store.ts"

export class MainTaskCoordinator {
  /** Keyed by main-repo key so concurrent calls don't double-create. */
  private readonly locks = new Map<string, Promise<Task>>()

  constructor(
    private readonly store: TaskIndexStore,
    private readonly forgetWorktree: (taskId: TaskId) => void,
  ) {}

  /**
   * Idempotent. A dir task on the exact root is PROMOTED, not joined by a
   * second row showing the same diff under one header. Promotion keeps its id,
   * so its terminal tabs move with it. Scratch rows are never promoted (cwd
   * unsettled; they belong to the Scratch bench).
   *
   * Throws on ineligible repos: callers here act on an explicit gesture
   * (`rove add`, `project.ensureMain`) where a silent no-op looks broken.
   * Internal callers use {@link ensureIfEligible}.
   */
  async ensure(repo: string): Promise<Task> {
    const task = await this.ensureIfEligible(repo, "explicit")
    if (task) return task
    const { repo: normalizedRepo } = normalizeMainRepo(repo)
    const rejected = projectRejection(normalizedRepo, isGitRepo, "explicit") ?? "notGitRepo"
    throw new Error(`cannot add ${normalizedRepo} as a project: ${rejectionReason(rejected)}`)
  }

  /**
   * {@link ensure}, but null instead of minting a row the path doesn't
   * deserve — keeps `/tmp` fixtures from becoming permanent project rows. The
   * task is still created; `buildTreeRows` derives a header from its repo when
   * no main row exists, so the header just stops outliving it.
   */
  async ensureIfEligible(repo: string, intent: ProjectIntent = "derived"): Promise<Task | null> {
    const { repo: normalizedRepo, key } = normalizeMainRepo(repo)
    const onThisRoot = (task: Task): boolean => normalizeMainRepo(task.repo).key === key
    const existing = this.store.list().find((task) => task.kind === "main" && onThisRoot(task))
    // Before the gate: it governs what may BECOME a project; a row predating
    // it must not start failing every task creation under it.
    if (existing) return existing
    if (projectRejection(normalizedRepo, isGitRepo, intent)) return null
    const inflight = this.locks.get(key)
    if (inflight) return inflight
    const promise = (async () => {
      // Project row and saved-repos entry are one fact; otherwise a row is
      // visible but unpickable, and hiding its last tab loses it for good.
      // `explicit`: the gate above already passed.
      addSavedRepo(normalizedRepo, { intent: "explicit" })
      const adoptable = this.store
        .list()
        .find((task) => task.kind === "dir" && task.scratch !== true && onThisRoot(task))
      // Retitled (the auto-name named a session); its engine choice survives.
      if (adoptable) return await this.store.update(adoptable.id, this.mainShape(normalizedRepo))
      return await this.store.create({
        ...this.mainShape(normalizedRepo),
        status: "backlog",
        // Per-repo last-active → global default → claude.
        vendor: resolvePreferredVendor(normalizedRepo),
      })
    })()
    this.locks.set(key, promise)
    try {
      return await promise
    } finally {
      this.locks.delete(key)
    }
  }

  /** Shared by create and adoption so they can't drift. */
  private mainShape(normalizedRepo: string): Pick<Task, "kind" | "title" | "repo" | "branch" | "worktreePath"> {
    return {
      kind: "main",
      title: titleFromRepo(normalizedRepo),
      repo: normalizedRepo,
      branch: "",
      // Remote main task lives at the remote basePath, not the ssh:// key.
      worktreePath: repoWorkingDir(normalizedRepo),
    }
  }

  /**
   * Inverse of {@link ensure} and the ONLY way to remove a main row (task
   * deletion refuses them). Drops the `savedRepos` entry (+ remote `ssh://`
   * config) and the row. Non-destructive: index only, never `git worktree
   * remove` (its `worktreePath` is the repo root). Idempotent.
   */
  async forget(repo: string): Promise<void> {
    if (!repo) throw new Error("forgetProject: repo is required")
    // Canonical key (git toplevel realpath, or verbatim ssh://): savedRepos and
    // the main task store different forms (`/var` vs `/private/var`).
    const key = normalizeMainRepo(repo).key
    for (const saved of getSavedRepos()) {
      if (normalizeMainRepo(saved).key === key) removeSavedRepo(saved)
    }
    for (const task of this.store.list()) {
      if (task.kind !== "main") continue
      if (normalizeMainRepo(task.repo).key !== key) continue
      await this.store.remove(task.id)
      this.forgetWorktree(task.id)
    }
  }
}
