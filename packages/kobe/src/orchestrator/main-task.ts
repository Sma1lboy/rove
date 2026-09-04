/**
 * The `kind:"main"` row's lifecycle for the {@link Orchestrator}.
 *
 * A main row is the sidebar's PROJECTS entry — the repo root itself, pinned
 * with no `git worktree add`. Creating one, adopting a directory session that
 * already sits on that root, and forgetting a project are one cohesive
 * concern with one shared invariant (the canonical main-repo key), so they
 * live here as a collaborator the Orchestrator holds and delegates to, beside
 * `TaskEditor` / `WorktreeCoordinator` / `TaskDeletionCoordinator`. The
 * Orchestrator keeps thin public methods so its interface is unchanged.
 * Moved from `core.ts`; the adoption branch is the only new behaviour.
 */

import { type ProjectIntent, projectRejection, rejectionReason } from "../state/project-eligibility.ts"
import { addSavedRepo, getSavedRepos, isGitRepo, removeSavedRepo } from "../state/repos.ts"
import { resolvePreferredVendor } from "../state/vendor-prefs.ts"
import type { Task, TaskId } from "../types/task.ts"
import { normalizeMainRepo, repoWorkingDir, titleFromRepo } from "./core-helpers.ts"
import type { TaskIndexStore } from "./index/store.ts"

/** Owns the Orchestrator's main-row create/adopt/forget. One per Orchestrator. */
export class MainTaskCoordinator {
  /** Lock keyed by main-repo key so concurrent calls don't double-create. */
  private readonly locks = new Map<string, Promise<Task>>()

  constructor(
    private readonly store: TaskIndexStore,
    /** Release a forgotten row's worktree bookkeeping. */
    private readonly forgetWorktree: (taskId: TaskId) => void,
  ) {}

  /**
   * Ensure a `kind: "main"` task exists for the given repo. Idempotent.
   *
   * A directory task already sitting on that exact root is PROMOTED rather
   * than joined by a second row. Both rows pin the same checkout, so minting
   * a main beside one gives two rows with the same diff under one project
   * header — one labelled by branch, one by path — reading as a duplicate of
   * itself. Promotion keeps the session's id, so its terminal tabs move under
   * the main row instead of being stranded. Scratch rows are never promoted:
   * their cwd is unsettled by definition and they belong to the Scratch bench.
   *
   * Ineligible repos throw — see {@link ensureIfEligible} for the variant
   * every internal caller uses. Direct callers are the ones acting on an
   * explicit user gesture (`rove add`, `project.ensureMain`), where a silent
   * no-op would look like the command did nothing.
   */
  async ensure(repo: string): Promise<Task> {
    const task = await this.ensureIfEligible(repo, "explicit")
    if (task) return task
    const { repo: normalizedRepo } = normalizeMainRepo(repo)
    const rejected = projectRejection(normalizedRepo, isGitRepo, "explicit") ?? "notGitRepo"
    throw new Error(`cannot add ${normalizedRepo} as a project: ${rejectionReason(rejected)}`)
  }

  /**
   * {@link ensure}, but returning null instead of creating a row the path
   * does not deserve.
   *
   * This is the gate on the leak that puts fixture paths permanently in the
   * sidebar (a dozen project rows behind two saved repos). `createTask`
   * and `adopt` call this while doing their real work: a task whose repo is a
   * `/tmp` fixture still gets created, it just does not also mint a permanent
   * project row. Nothing breaks downstream — `buildTreeRows` derives a
   * project header from the task's own repo when no main row exists ("then
   * main-less projects in first-seen order"), so the task still renders under
   * a header; the header simply stops outliving it.
   */
  async ensureIfEligible(repo: string, intent: ProjectIntent = "derived"): Promise<Task | null> {
    const { repo: normalizedRepo, key } = normalizeMainRepo(repo)
    const onThisRoot = (task: Task): boolean => normalizeMainRepo(task.repo).key === key
    const existing = this.store.list().find((task) => task.kind === "main" && onThisRoot(task))
    // An existing row short-circuits BEFORE the gate: the rule governs what
    // may BECOME a project, not what already is one. Re-gating here would
    // make a row that predates the gate start failing every task creation
    // under it — punishing the user for state we produced.
    if (existing) return existing
    if (projectRejection(normalizedRepo, isGitRepo, intent)) return null
    const inflight = this.locks.get(key)
    if (inflight) return inflight
    const promise = (async () => {
      // A project row and a saved-repos entry are the same fact: the sidebar
      // shows what the new-task picker offers. Written by separate paths they
      // diverge: a row minted here (`createTask` on a fresh repo) would be a
      // project you can SEE but cannot pick, and closing its last tab (which
      // hides it) would lose it with no way back. `explicit`: this path
      // already passed the admission gate above.
      addSavedRepo(normalizedRepo, { intent: "explicit" })
      const adoptable = this.store
        .list()
        .find((task) => task.kind === "dir" && task.scratch !== true && onThisRoot(task))
      // The dir row's auto-name (`quill-all-3ump`) named a session, not a
      // project. Its own engine choice survives — only the shape changes.
      if (adoptable) return await this.store.update(adoptable.id, this.mainShape(normalizedRepo))
      return await this.store.create({
        ...this.mainShape(normalizedRepo),
        status: "backlog",
        // A project's main chat opens with the repo's preferred engine
        // (per-repo last-active → global default → claude).
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

  /** The fields that MAKE a row the repo's main row — the one definition both
   *  the create and the adoption path write, so they can't drift apart. */
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
   * Forget a saved project: drop it from `savedRepos` (+ any remote `ssh://`
   * connection config) AND remove the synthetic `kind:"main"` sidebar row.
   * Non-destructive — the repo's files, branches, and non-main task worktrees
   * all stay; only the picker entry + project header go away. The inverse of
   * {@link ensure} and the ONE supported way to remove a main row (task
   * deletion refuses them — they project `savedRepos`, not real work). The
   * main row's `worktreePath` is the repo root, so this touches only the
   * index, never `git worktree remove`. Idempotent.
   */
  async forget(repo: string): Promise<void> {
    if (!repo) throw new Error("forgetProject: repo is required")
    // Match by the canonical main-repo key (realpath of the git toplevel, or
    // the verbatim ssh:// key) so a subdir / differently-realpathed input
    // (`/var` vs `/private/var` on macOS) still hits the stored savedRepos
    // entry and the stored main task — the two are written in different forms
    // (caller path vs git output), so a plain string compare misses.
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
