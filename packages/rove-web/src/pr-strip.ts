/** Which PR actions apply to a task, from the PR state the feed already carries. */

import type { TaskRow } from "rove-bridge/protocol"

export type PrAction = "createPR" | "conflicts" | "fixCI" | "comments" | "archive"

/** The actions that prefill the engine's input; the rest act directly. */
export type PrPromptKind = Exclude<PrAction, "archive">

/**
 * Only what applies, in the order a PR gets unblocked: conflicts first (CI will rerun after the
 * merge), then red checks, then review feedback. A merged PR offers archive alone; a closed or
 * not-yet-polled one offers nothing, since its state is not known to act on.
 */
export function prActions(task: TaskRow): readonly PrAction[] {
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
