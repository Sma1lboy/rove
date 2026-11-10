import { pathIdentity } from "@sma1lboy/rove-daemon/path-identity"

/**
 * Finds persisted `dir` tasks pinned to a repo root, so they can be promoted
 * into that repo's `main` row (outside it they miss the sidebar's project
 * ordering, pin and fold). `MainTaskCoordinator.ensure` does the promotion
 * (its `adoptable` branch keeps the task id, so terminal tabs move) but only
 * runs when someone names the repo; this is the sweep.
 *
 * Pure over the task list with `isRepoRoot` injected, so each exclusion — a row
 * that LOOKS promotable and must not be — is testable without git.
 */

import type { Task } from "../types/task.ts"

/** A task list plus the question this sweep needs answered about paths. */
export interface PromotableDeps {
  readonly tasks: readonly Task[]
  /** True when `path` is the toplevel of a git repository. */
  readonly isRepoRoot: (path: string) => boolean
}

/**
 * The repo roots that a `dir` task occupies and no `main` row claims yet.
 *
 * Excludes:
 *   - **scratch** and **no-project** rows — a scratch shell started inside a repo is still scratch,
 *     and a projectless routine's directory never becomes a project;
 *   - roots that ALREADY have a main row — that would mint a duplicate;
 *   - a `dir` task pinned to a SUBDIRECTORY (`my-monorepo/packages/app` is a
 *     deliberate choice; promoting would re-target the whole monorepo);
 *   - a **shared child** — a conversation inside another task's directory.
 */
export function promotableDirTasks(deps: PromotableDeps): readonly Task[] {
  const claimed = new Set(deps.tasks.filter((task) => task.kind === "main").map((task) => pathIdentity(task.repo)))
  const seen = new Set<string>()
  const out: Task[] = []
  for (const task of deps.tasks) {
    if (task.kind !== "dir" || task.scratch === true || task.noProject === true || task.sharesWorkspaceOf) continue
    // A dir task's `repo` IS its pinned directory: "is it a repo root", not "inside one".
    const path = task.repo
    const key = pathIdentity(path)
    if (!path || claimed.has(key) || seen.has(key)) continue
    if (!deps.isRepoRoot(path)) continue
    seen.add(key)
    out.push(task)
  }
  return out
}
