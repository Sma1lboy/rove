/**
 * Searching the sidebar tree — pruning `buildTreeRows`' output to a query.
 *
 * Split from `tree-core.ts` at the file-size cap. It is a genuinely separate
 * concern: `tree-core` decides what rows EXIST, this decides which of them
 * survive a query, and the two share only the row shape. `filterTreeRows` is
 * re-exported from `tree-core` so callers still import the tree's vocabulary
 * from one place.
 *
 * The governing rule, and the reason the haystacks look the way they do: what
 * you can FIND is exactly what you can SEE. A row is matched on the text it
 * actually renders, never on a stored field the row refuses to show.
 *
 * Pure: no Solid, no React, no opentui.
 */

import type { Task } from "@/types/task"
import { fuzzyMatch } from "./fuzzy"
import { repoBasename } from "./groups"
import { type TreeRow, ownerProjectKey, worktreeRowLabel } from "./tree-core"

/**
 * The fields a row's query is matched against, ONE AT A TIME (see
 * `matchesRow`) — the criterion is that what you can
 * FIND is exactly what you can SEE, so a worktree row's haystack starts from
 * the very label `worktreeRowLabel` renders it with.
 *
 * Two kinds of row were unsearchable by their own visible text before that:
 *   - a `main` row is labelled by its LIVE polled HEAD (its stored `branch` is
 *     always `""`), so searching the branch name printed on the row missed it;
 *   - a `dir` / scratch row is labelled by its tail-truncated path while its
 *     stored title is deliberately ignored as auto-generated noise — and the
 *     haystack searched precisely that ignored title and never the path.
 *
 * `liveBranch` resolves the polled HEAD for the rows that own no branch (see
 * {@link rowLiveBranchPath}); without it the label falls back to the stored
 * branch, which is what a pure unit test wants.
 */
function rowHaystacks(row: TreeRow, liveBranch?: (task: Task) => string): readonly string[] {
  if (row.kind === "project") return [row.label]
  // The routine count row carries a translated count, not a name worth
  // matching. It is dropped from a search entirely (see `filterTreeRows`):
  // while searching, the routine tasks it folds are shown DIRECTLY, so the
  // toggle would be a fold with nothing left under it.
  if (row.kind === "routines") return []
  if (row.kind === "tab") return [row.tab.label]
  const task = row.task
  // A `dir` task's stored title is the noise the row refuses to show; it must
  // not be findable either, or the search hits text that is nowhere on screen.
  const title = task.kind === "dir" ? "" : task.title
  return [worktreeRowLabel(task, { liveBranch: liveBranch?.(task) }), title, repoBasename(task.repo)]
}

/**
 * Match the query against each of a row's fields SEPARATELY, never against
 * their concatenation. `fuzzyMatch` is a subsequence test, so one joined
 * string lets a query straddle a boundary and hit a row that shows the
 * matched characters nowhere together: `feat/tree` found a `feat/chat` row by
 * spending `feat/` on the branch and `tree` on the title beside it.
 */
function matchesRow(query: string, row: TreeRow, liveBranch?: (task: Task) => string): boolean {
  return rowHaystacks(row, liveBranch).some((field) => field !== "" && fuzzyMatch(query, field))
}

/**
 * Prune the tree to what matches `query`, keeping every hit's ANCESTORS so a
 * match never floats free of the worktree and project it lives in.
 *
 * Match semantics per kind, chosen so one query answers all three questions
 * the tree can be asked:
 *   - project  → repo basename. A hit keeps the WHOLE subtree ("show me
 *     everything in kobe").
 *   - worktree → the row's own RENDERED label (branch, live HEAD, or path)
 *     plus its title and repo basename. A hit keeps the worktree's tabs
 *     ("that branch, and what's running in it").
 *   - tab      → the tab's label, i.e. its live OSC window title. This is the
 *     tree's own increment over the flat sidebar, which can only search task
 *     titles: it answers "which tab is running that thing".
 */
export function filterTreeRows(
  rows: readonly TreeRow[],
  query: string,
  liveBranch?: (task: Task) => string,
): TreeRow[] {
  const q = query.trim()
  if (q === "") return [...rows]

  // Pass 1 — rows matching on their own text, plus the ancestors each hit
  // keeps alive.
  const selfMatch = new Set<string>()
  const keep = new Set<string>()
  for (const row of rows) {
    if (!matchesRow(q, row, liveBranch)) continue
    selfMatch.add(row.id)
    keep.add(row.id)
    if (row.kind === "project" || row.kind === "routines") continue
    if (row.kind === "tab") keep.add(row.task.id)
    const project = ownerProjectKey(row.task)
    if (project !== null) keep.add(project)
  }

  // Pass 2 — emit a row when it matched, when a descendant kept it, or when
  // an ancestor matched outright (a project hit brings its subtree along).
  const out: TreeRow[] = []
  for (const row of rows) {
    if (row.kind === "project") {
      if (keep.has(row.id)) out.push(row)
      continue
    }
    // A search shows every matching routine session directly, so the fold
    // toggle itself never survives one. Hiding a row at rest must not make it
    // unfindable — search is precisely how you reach a folded row without
    // opening the fold first.
    if (row.kind === "routines") continue
    const project = ownerProjectKey(row.task)
    const underMatchedProject = project !== null && selfMatch.has(project)
    if (row.kind === "worktree") {
      if (underMatchedProject || keep.has(row.id)) out.push(row)
      continue
    }
    if (underMatchedProject || selfMatch.has(row.task.id) || keep.has(row.id)) out.push(row)
  }
  return out
}
