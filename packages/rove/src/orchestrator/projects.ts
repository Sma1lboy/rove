/**
 * Which repos are projects for the {@link Orchestrator}: save one, forget one.
 * A project is a `savedRepos` entry; no task row stands for it. A session in
 * its checkout is a `dir` task like any other. Shared invariant: the canonical
 * main-repo key.
 */

import { type ProjectIntent, projectRejection, rejectionReason } from "@sma1lboy/rove-core/state/project-eligibility.ts"
import { addSavedRepo, isGitRepo, removeSavedRepo, storedRepos } from "@sma1lboy/rove-core/state/repos.ts"
import { normalizeMainRepo } from "./core-helpers.ts"

export class ProjectCoordinator {
  /**
   * Idempotent; returns the normalized repo. Throws on an ineligible repo:
   * callers here act on an explicit gesture (`rove add`, `project.ensure`)
   * where a silent no-op looks broken. Internal callers use {@link ensureIfEligible}.
   */
  ensure(repo: string): string {
    const saved = this.ensureIfEligible(repo, "explicit")
    if (saved) return saved
    const { repo: normalizedRepo } = normalizeMainRepo(repo)
    const rejected = projectRejection(normalizedRepo, isGitRepo, "explicit") ?? "notGitRepo"
    throw new Error(`cannot add ${normalizedRepo} as a project: ${rejectionReason(rejected)}`)
  }

  /** {@link ensure}, but null for a path that may not be a project (a `/tmp` fixture stays out of the picker). */
  ensureIfEligible(repo: string, intent: ProjectIntent = "derived"): string | null {
    const { repo: normalizedRepo, key } = normalizeMainRepo(repo)
    // Before the gate: it governs what may BECOME a project, not one already saved.
    if (storedRepos().some((saved) => normalizeMainRepo(saved).key === key)) return normalizedRepo
    if (projectRejection(normalizedRepo, isGitRepo, intent)) return null
    // `explicit`: the gate above already passed.
    addSavedRepo(normalizedRepo, { intent: "explicit" })
    return normalizedRepo
  }

  /**
   * Inverse of {@link ensure}: drops the `savedRepos` entry (+ remote `ssh://`
   * config). Sessions under the project stay, under a header derived from
   * their own repo. Idempotent.
   */
  forget(repo: string): void {
    if (!repo) throw new Error("forgetProject: repo is required")
    // Canonical key (git toplevel realpath, or verbatim ssh://): saved forms differ (`/var` vs `/private/var`).
    const key = normalizeMainRepo(repo).key
    for (const saved of storedRepos()) {
      if (normalizeMainRepo(saved).key === key) removeSavedRepo(saved)
    }
  }
}
