/** What Retry reopens New session with, and how the composer turns that seed into picks. Pure, so the mapping is testable. */

import type { TaskRow } from "rove-bridge/protocol"
import type { NewSessionStart } from "./ui.ts"

/** The slice of `task.get` Retry reads. */
export interface RetryBrief {
  readonly prompt: string
  readonly repo: string
  readonly engine?: string
  readonly baseRef?: string
  /** A multi-repo task's other repos, in pick order. */
  readonly extraRepos?: readonly { readonly repo: string; readonly baseRef?: string }[]
}

type RetryRow = Pick<TaskRow, "id" | "label" | "kind" | "scratch" | "noProject" | "machine">

export function retrySeed(task: RetryRow, brief: RetryBrief): NewSessionStart {
  const ungrouped = task.scratch || task.noProject
  const extras = ungrouped ? [] : (brief.extraRepos ?? [])
  return {
    ...(ungrouped ? { ungrouped: true as const } : { repo: brief.repo }),
    ...(brief.baseRef ? { baseBranch: brief.baseRef } : {}),
    ...(extras.length > 0 ? { extras } : {}),
    ...(task.machine ? { machine: task.machine.id } : {}),
    prompt: brief.prompt,
    ...(brief.engine ? { engine: brief.engine } : {}),
    // A project's own checkout (main, or a directory task) retries in place; a managed task in a worktree.
    worktree: task.kind === "task",
    retryOf: { id: task.id, label: task.label },
  }
}

/** The picked repos: the starting project, then the retried task's other repos. */
export function seededRepos(start: string | undefined, seed: Pick<NewSessionStart, "extras">): readonly string[] {
  return start ? [start, ...(seed.extras ?? []).map((e) => e.repo)] : []
}

/** The ref each seeded repo's worktree branches from; a repo with none keeps its current branch. */
export function seededBases(
  start: string | undefined,
  seed: Pick<NewSessionStart, "baseBranch" | "extras">,
): Readonly<Record<string, string>> {
  if (!start) return {}
  return {
    ...(seed.baseBranch ? { [start]: seed.baseBranch } : {}),
    ...Object.fromEntries((seed.extras ?? []).flatMap((e) => (e.baseRef ? [[e.repo, e.baseRef]] : []))),
  }
}

/** The composer's mount identity: a seed that differs here remounts it, so its chips follow the new seed. */
export function composerKey(seed: NewSessionStart): string {
  return [
    seed.machine ?? "",
    seed.repo ?? "",
    seed.ungrouped ? "u" : "",
    seed.retryOf?.id ?? "",
    seed.baseBranch ?? "",
    seed.worktree === undefined ? "" : String(seed.worktree),
  ].join("\0")
}

/** The task whose launch command the new one keeps: only while it still runs the engine that task ran. */
export function retryCommandFrom(
  seed: Pick<NewSessionStart, "retryOf" | "engine">,
  engine: string,
): string | undefined {
  return seed.retryOf && seed.engine && seed.engine === engine ? seed.retryOf.id : undefined
}
