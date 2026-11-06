/** Stacked work: tasks whose branch was cut from another task's. Pure over the feed's rows. */

import type { TaskRow } from "rove-bridge/protocol"

const SHA = /^[0-9a-f]{7,40}$/i

/** The task this one is stacked on: the one whose branch it was cut from, else (a cut child) its parent. */
export function stackParent(rows: readonly TaskRow[], row: TaskRow): TaskRow | null {
  if (row.sharesWorkspaceOf || !row.baseRef) return null
  const byBranch = rows.find((r) => r.id !== row.id && r.branch !== "" && r.branch === row.baseRef)
  if (byBranch) return byBranch
  if (SHA.test(row.baseRef) && row.parentTaskId) return rows.find((r) => r.id === row.parentTaskId) ?? null
  return null
}

export interface Stack {
  /** Bottom first; the open task is `at`. */
  readonly nodes: readonly TaskRow[]
  readonly at: number
  /** The ref the bottom link was cut from, when it is a branch name (`main`). */
  readonly base: string | null
}

/** The task's ancestors, itself, then the tasks stacked directly on it; null when it is in no stack. */
export function stackOf(rows: readonly TaskRow[], row: TaskRow): Stack | null {
  const up: TaskRow[] = []
  for (let cur = stackParent(rows, row); cur && up.length < 20 && !up.includes(cur); cur = stackParent(rows, cur)) {
    up.unshift(cur)
  }
  const kids = rows
    .filter((r) => !r.deleting && stackParent(rows, r)?.id === row.id)
    .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""))
  if (up.length === 0 && kids.length === 0) return null
  const bottom = up[0] ?? row
  const base = bottom.baseRef && !SHA.test(bottom.baseRef) ? bottom.baseRef : null
  return { nodes: [...up, row, ...kids], at: up.length, base }
}

export const isMerged = (row: TaskRow): boolean => row.pr?.lifecycle === "merged"

/** The lowest link not yet merged: the only one that can land now. */
export function bottomUnmerged(stack: Stack): TaskRow | null {
  return stack.nodes.find((n) => !isMerged(n)) ?? null
}
