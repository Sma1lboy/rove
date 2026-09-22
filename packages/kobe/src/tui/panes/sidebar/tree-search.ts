/**
 * Prunes `buildTreeRows`' output to a query (re-exported from `tree-core`).
 *
 * Governing rule: what you can FIND is exactly what you can SEE. A row matches
 * on the text it renders, never on a stored field it refuses to show.
 */

import type { Task } from "@/types/task"
import { fuzzyMatch } from "./fuzzy"
import { repoBasename } from "./groups"
import { type TreeRow, ownerProjectKey, worktreeRowLabel } from "./tree-core"

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
  // Shown name plus the `rove machine add` alias, which differ when the alias is shorter.
  if (row.kind === "machine") return [row.label, row.alias]
  // A translated count, and dropped from searches anyway (see `filterTreeRows`).
  if (row.kind === "routines") return []
  if (row.kind === "tab") return [row.tab.label]
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
 *     basename; a hit keeps its tabs.
 *   - tab      → its live OSC window title ("which tab is running that").
 */
export function filterTreeRows(
  rows: readonly TreeRow[],
  query: string,
  liveBranch?: (task: Task) => string,
): TreeRow[] {
  const q = query.trim()
  if (q === "") return [...rows]

  // Pass 1: self-matches, plus the ancestors each keeps alive.
  const selfMatch = new Set<string>()
  const keep = new Set<string>()
  for (const row of rows) {
    if (!matchesRow(q, row, liveBranch)) continue
    selfMatch.add(row.id)
    keep.add(row.id)
    if (row.kind === "project" || row.kind === "machine" || row.kind === "routines") continue
    if (row.kind === "tab") keep.add(row.task.id)
    const project = ownerProjectKey(row.task)
    if (project !== null) keep.add(project)
  }

  // Pass 2: emit if matched, kept by a descendant, or under a matched project.
  const out: TreeRow[] = []
  for (const row of rows) {
    if (row.kind === "project") {
      if (keep.has(row.id)) out.push(row)
      continue
    }
    // Decided in a final pass: a header survives only if something under it did.
    if (row.kind === "machine") {
      out.push(row)
      continue
    }
    // Search shows matching routine sessions directly (folded rows must stay
    // findable), so the fold toggle would have nothing under it.
    if (row.kind === "routines") continue
    const project = ownerProjectKey(row.task)
    const underMatchedProject = project !== null && selfMatch.has(project)
    if (row.kind === "worktree") {
      if (underMatchedProject || keep.has(row.id)) out.push(row)
      continue
    }
    if (underMatchedProject || selfMatch.has(row.task.id) || keep.has(row.id)) out.push(row)
  }
  return dropEmptyMachineSections(out)
}

/** Drop a machine header that no surviving row follows. */
function dropEmptyMachineSections(rows: readonly TreeRow[]): TreeRow[] {
  const out: TreeRow[] = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!row) continue
    if (row.kind === "machine") {
      const next = rows[i + 1]
      if (!next || next.kind === "machine") continue
    }
    out.push(row)
  }
  return out
}
