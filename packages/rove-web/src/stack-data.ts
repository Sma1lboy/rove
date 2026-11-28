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
  /** The open task's ancestors, bottom first. */
  readonly path: readonly TaskRow[]
  /** The open task and its siblings (stacked on the same link), oldest first: parallel, not a chain. */
  readonly level: readonly TaskRow[]
  /** The tasks stacked directly on the open one, oldest first: parallel too. */
  readonly kids: readonly TaskRow[]
  /** The ref the bottom link was cut from, when it is a branch name (`main`). */
  readonly base: string | null
}

const byAge = (a: TaskRow, b: TaskRow): number => (a.createdAt ?? "").localeCompare(b.createdAt ?? "")
const stackedOn = (rows: readonly TaskRow[], id: string): TaskRow[] =>
  rows.filter((r) => !r.deleting && stackParent(rows, r)?.id === id).sort(byAge)

/** The task's ancestors, it among its siblings, then the tasks stacked on it; null when it is in no stack. */
export function stackOf(rows: readonly TaskRow[], row: TaskRow): Stack | null {
  const path: TaskRow[] = []
  for (let cur = stackParent(rows, row); cur && path.length < 20 && !path.includes(cur); cur = stackParent(rows, cur)) {
    path.unshift(cur)
  }
  const kids = stackedOn(rows, row.id)
  if (path.length === 0 && kids.length === 0) return null
  const parent = path[path.length - 1]
  const level = parent ? stackedOn(rows, parent.id) : [row]
  if (!level.includes(row)) level.push(row)
  const bottom = path[0] ?? row
  const base = bottom.baseRef && !SHA.test(bottom.baseRef) ? bottom.baseRef : null
  return { path, level, kids, base }
}

export const isMerged = (row: TaskRow): boolean => row.pr?.lifecycle === "merged"

/** The lowest link not yet merged on the open task's own line: the only one that can land now. */
export function bottomUnmerged(stack: Stack, taskId: string): TaskRow | null {
  const own = stack.level.find((n) => n.id === taskId)
  const line = own ? [...stack.path, own] : stack.path
  const [only, ...more] = stack.kids
  return line.find((n) => !isMerged(n)) ?? (only && more.length === 0 && !isMerged(only) ? only : null)
}
