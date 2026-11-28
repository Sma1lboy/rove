/**
 * Can this PR land? The web's rail draws it; the terminal's task list stays bare. Priority:
 * conflicts with its base, then checks failing, then checks passing.
 *
 * Pending checks, review, merged/closed and board status give nothing. An
 * unreachable provider (`prStatus.lastError`) keeps the last good value but
 * drains its colour.
 */

import { rollupPr } from "@sma1lboy/rove-core/orchestrator/task-tree.ts"
import type { Task, TaskPRStatus } from "@sma1lboy/rove-core/types/task.ts"

export type SidebarTone = "success" | "warning" | "primary" | "textMuted" | "error"

export type PrChip = { kind: "conflict" | "failing" | "passing"; tone: SidebarTone }

function chipOf(pr: TaskPRStatus | undefined): PrChip | null {
  if (!pr) return null
  const stale = pr.lastError !== undefined
  if ((pr.mergeable ?? "").toUpperCase() === "CONFLICTING")
    // Amber: a wait the task can clear (rebase), where red is checks that failed.
    return { kind: "conflict", tone: stale ? "textMuted" : "warning" }
  if (pr.checkState === "failing") return { kind: "failing", tone: stale ? "textMuted" : "error" }
  if (pr.checkState === "passing") return { kind: "passing", tone: stale ? "textMuted" : "success" }
  return null
}

/** The task's own PR (all its repos rolled up). */
export function prChip(task: Task): PrChip | null {
  return chipOf(rollupPr(task))
}

/**
 * {@link prChip} over the task's own PRs plus the polled PRs its session
 * attached (`rove api pr-attach`), so a `dir` task with no branch of its own still shows one.
 */
export function sidebarPrChip(task: Task): PrChip | null {
  const attached = (task.sessionPrs ?? []).flatMap((entry) => (entry.status ? [{ prStatus: entry.status }] : []))
  return chipOf(rollupPr({ prStatus: task.prStatus, extraRepos: [...(task.extraRepos ?? []), ...attached] }))
}
