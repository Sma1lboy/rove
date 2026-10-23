/**
 * Prunes `buildTreeRows`' output to a query (re-exported from `tree-core`).
 *
 * Governing rule: what you can FIND is exactly what you can SEE. A row matches
 * on the text it renders, never on a stored field it refuses to show.
 */

import type { Task } from "@/types/task"
import { fuzzyMatch } from "./fuzzy"
import { repoBasename } from "./groups"
import { type TreeRow, worktreeRowLabel } from "./tree-core"

/**
 * Fields matched ONE AT A TIME (see `matchesRow`). A worktree row starts from
 * the label `worktreeRowLabel` renders: a `main` row shows its LIVE HEAD (stored
 * `branch` is `""`), a `dir` row its path (its auto-generated title is hidden).
 *
 * `liveBranch` resolves the polled HEAD for branchless rows (see
 * {@link rowLiveBranchPath}); without it the stored branch is used.
 */
function rowHaystacks(row: TreeRow, liveBranch?: (task: Task) => string): readonly string[] {
  if (row.kind === "project") return [row.label]
  // A translated count, and dropped from searches anyway (see `filterTreeRows`).
  if (row.kind === "routines") return []
  const task = row.task
  // A `dir` task's title is hidden on screen, so it must not match either.
  const title = task.kind === "dir" ? "" : task.title
  return [worktreeRowLabel(task, { liveBranch: liveBranch?.(task) }), title, repoBasename(task.repo)]
}

/**
 * Each field SEPARATELY, never concatenated: `fuzzyMatch` is a subsequence
 * test, so a joined string lets `feat/tree` match a `feat/chat` row by spending
 * `tree` on the title beside it.
 */
function matchesRow(query: string, row: TreeRow, liveBranch?: (task: Task) => string): boolean {
  return rowHaystacks(row, liveBranch).some((field) => field !== "" && fuzzyMatch(query, field))
}

/**
 * Prune to matches, keeping every hit's ANCESTORS.
 *   - project  → repo basename; a hit keeps the WHOLE subtree.
 *   - worktree → rendered label (branch, live HEAD, or path), title, repo
 *     basename; a hit keeps its child tasks and the parents above it.
 */
export function filterTreeRows(
  rows: readonly TreeRow[],
  query: string,
  liveBranch?: (task: Task) => string,
): TreeRow[] {
  const q = query.trim()
  if (q === "") return [...rows]

  // A row's project is the header it sits under — the grouping already
  // merged every machine's checkout of a repo, so a task's own checkout key
  // would name a header that isn't there.
  const projectOf = new Map<string, string>()
  const taskRows = new Map<string, TreeRow>()
  let header: string | null = null
  for (const row of rows) {
    if (row.kind === "project") header = row.id
    else if (header !== null) projectOf.set(row.id, header)
    if (row.kind === "worktree") taskRows.set(row.id, row)
  }
  // The row of a task's parent, when it is on screen (a parent elsewhere left the child top-level).
  const parentRowId = (row: TreeRow): string | undefined => {
    const parent = row.kind === "worktree" ? row.task.parentTaskId : undefined
    return parent !== undefined && taskRows.has(parent) ? parent : undefined
  }

  // Pass 1: self-matches, plus the ancestors each keeps alive.
  const selfMatch = new Set<string>()
  const keep = new Set<string>()
  for (const row of rows) {
    if (!matchesRow(q, row, liveBranch)) continue
    selfMatch.add(row.id)
    keep.add(row.id)
    if (row.kind === "project" || row.kind === "routines") continue
    const project = projectOf.get(row.id)
    if (project !== undefined) keep.add(project)
    for (let up = parentRowId(row); up !== undefined && !keep.has(up); ) {
      keep.add(up)
      const parentRow = taskRows.get(up)
      up = parentRow ? parentRowId(parentRow) : undefined
    }
  }

  const underMatchedParent = (row: TreeRow): boolean => {
    const seen = new Set<string>()
    for (let up = parentRowId(row); up !== undefined && !seen.has(up); ) {
      if (selfMatch.has(up)) return true
      seen.add(up)
      const parentRow = taskRows.get(up)
      up = parentRow ? parentRowId(parentRow) : undefined
    }
    return false
  }

  // Pass 2: emit if matched, kept by a descendant, or under a matched project or parent.
  const out: TreeRow[] = []
  for (const row of rows) {
    if (row.kind === "project") {
      if (keep.has(row.id)) out.push(row)
      continue
    }
    // Search shows matching routine sessions directly (folded rows must stay
    // findable), so the fold toggle would have nothing under it.
    if (row.kind === "routines") continue
    const project = projectOf.get(row.id)
    const underMatchedProject = project !== undefined && selfMatch.has(project)
    if (underMatchedProject || keep.has(row.id) || underMatchedParent(row)) out.push(row)
  }
  return out
}
