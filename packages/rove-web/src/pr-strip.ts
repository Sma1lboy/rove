/** Which PR actions apply to a task, from the PR state the feed already carries. */

import type { TaskRow } from "rove-bridge/protocol"

export type PrAction = "commit" | "createPR" | "conflicts" | "fixCI" | "comments" | "archive"

/** The actions that prefill the engine's input; the rest act directly. */
export type PrPromptKind = Exclude<PrAction, "archive">

/** An own worktree task with uncommitted changes (never one whose changes could not be read). */
function dirty(task: TaskRow): boolean {
  const own = task.kind === "task" && !task.noWorktree && !task.machine && !task.archived
  const changes = task.changes
  return own && !!changes && "added" in changes && changes.added + changes.deleted > 0
}

/**
 * Commit first when the worktree is dirty (it needs no PR). Then only what applies to the PR, in the order
 * it gets unblocked: conflicts (CI reruns after the merge), red checks, then review feedback. A merged PR
 * offers archive; a closed or not-yet-polled one nothing, since its state is not known to act on.
 */
export function prActions(task: TaskRow): readonly PrAction[] {
  return [...(dirty(task) ? (["commit"] as const) : []), ...prStateActions(task)]
}

function prStateActions(task: TaskRow): readonly PrAction[] {
  const pr = task.pr
  if (!pr) {
    // Only a worktree task opens PRs from its own branch.
    const own = task.kind === "task" && !task.noWorktree && !task.machine && !task.archived
    return own && !task.sessionPrs?.length ? ["createPR"] : []
  }
  if (pr.lifecycle === "merged") return task.archived || task.kind === "main" ? [] : ["archive"]
  if (pr.lifecycle !== "open" && pr.lifecycle !== "ready_to_merge") return []
  const out: PrAction[] = []
  if ((pr.mergeable ?? "").toUpperCase() === "CONFLICTING" || task.prChip === "conflict") out.push("conflicts")
  if (pr.checkState === "failing") out.push("fixCI")
  if ((pr.reviewDecision ?? "").toUpperCase() === "CHANGES_REQUESTED") out.push("comments")
  return out
}
