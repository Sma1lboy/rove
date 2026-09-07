/**
 * How a sidebar-tree row is NAMED and ADDRESSED — split out of `tree-core.ts`,
 * which decides which rows exist and in what order.
 *
 * The seam: nothing here reads the task list. Given one row (or one id) these
 * answer "what is it called" and "which task and tab is it", and that is the
 * whole file. `tree-core.ts` re-exports every public name, so callers still
 * import the tree's vocabulary from one place.
 */

import { homedir } from "node:os"
import type { Task } from "@/types/task"
import { truncateStart } from "../../lib/truncate"

/** Separator between a task id and a tab id in a tab row's id. Matches the
 *  PTY registry's key format so one parse rule covers both. */
const TAB_ROW_SEPARATOR = "::"

/**
 * Navigation id of the narrow-mode "↩ recent" jump row.
 * Not a ULID and free of {@link TAB_ROW_SEPARATOR}, so `parseRowId` on it
 * yields a task id no task can have — cursor chords that don't special-case
 * it fall through to a lookup miss instead of acting on a real task.
 */
export const RECENT_ROW_ID = "~recent"

/**
 * Header id of the Scratch section. Like {@link RECENT_ROW_ID},
 * not a repo path and free of the separator, so project-header consumers
 * (move mode, context menu, `mainTaskIdOfProject`) that look it up simply
 * miss — a Scratch header has no main task to move and no repo to file into.
 */
export const SCRATCH_SECTION_ID = "~scratch"

/**
 * Navigation id of a project's routine count row. Prefixed like
 * the other sentinels so it can never collide with a ULID, and carrying the
 * project key so two projects' rows stay distinct.
 *
 * This row is the ONE fold in a tree that otherwise has none (see
 * `tree-panel.tsx`). It is scoped deliberately: it
 * folds only tasks a SCHEDULE created, never a task a human opened, so the
 * "everything under a project is always visible" promise still holds for
 * everything the user made themselves.
 */
export function routinesRowId(projectKey: string): string {
  return `~routines:${projectKey}`
}

/** The project key a routines row id names, or null for any other id. */
export function projectKeyOfRoutinesRow(id: string): string | null {
  return id.startsWith("~routines:") ? id.slice("~routines:".length) : null
}

/** Compose a tab row's navigation id. */
export function tabRowId(taskId: string, tabId: string): string {
  return `${taskId}${TAB_ROW_SEPARATOR}${tabId}`
}

/**
 * Split a row id back into its parts. A task row id has no separator and
 * yields `tabId: null` — callers switch on that rather than string-matching
 * the separator themselves.
 *
 * Task ids are ULIDs and tab ids are `tab-N`, so neither contains the
 * separator; splitting on the FIRST occurrence is unambiguous either way.
 */
export function parseRowId(rowId: string): { taskId: string; tabId: string | null } {
  const at = rowId.indexOf(TAB_ROW_SEPARATOR)
  if (at < 0) return { taskId: rowId, tabId: null }
  return { taskId: rowId.slice(0, at), tabId: rowId.slice(at + TAB_ROW_SEPARATOR.length) }
}

/** Widest path label a worktree row renders before tail-truncation — the

 *  default rail width minus row chrome. The row's flex still end-clips on
 *  narrower rails; pre-truncating from the START keeps the leaf visible at
 *  the default width, which is the half that disambiguates a path. */
const PATH_LABEL_MAX = 24

/**
 * What a worktree row is CALLED — the one derivation rule:
 * a task with a branch is named by it; a branchless `dir` task (plain
 * `rove .` opens and scratch shells alike) by its tail-truncated
 * directory — the stored title is deliberately ignored there, because
 * dir-task titles are auto-generated noise (`jacksonc-xxxx`) and existing
 * rows render by this rule with no data migration. A regular task
 * before its worktree materialises (no branch yet, path not its own)
 * keeps its title, else the label falls back to the path and finally
 * "scratch" so a row is never blank.
 *
 * `liveBranch` is the caller-resolved HEAD for the rows that own no branch of
 * their own (see {@link rowLiveBranchPath} and `git-head.ts`); `home` is
 * injectable so the tildification unit-tests without the real $HOME.
 */
/**
 * The checkout whose LIVE HEAD names this row, or `""` when the row already
 * carries its own branch.
 *
 * Rove-created worktrees store `branch`, so their label is fixed. Two kinds
 * store none and move freely: `main` (its checkout is the user's to switch)
 * and `dir` — an arbitrary directory the user opened, which is what a scratch
 * shell becomes. A scratch shell opened inside a repo IS on a branch, so
 * labelling it with its path while every worktree row beside it showed a
 * branch made it read as a different species of row. Not-a-repo still falls
 * back to the path: the poller answers `""` for anything it can't resolve.
 */
export function rowLiveBranchPath(task: Task): string {
  if (task.kind !== "main" && task.kind !== "dir") return ""
  return task.worktreePath || task.repo || ""
}

export function worktreeRowLabel(
  task: Task,
  opts: { readonly liveBranch?: string; readonly home?: string } = {},
): string {
  const branch = (opts.liveBranch ?? task.branch) || task.branch
  if (branch) return branch
  if (task.kind !== "dir" && task.title) return task.title
  const path = task.worktreePath || task.repo
  if (path) {
    const home = opts.home ?? homedir()
    const tildified = home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path
    return truncateStart(tildified, PATH_LABEL_MAX)
  }
  return task.title || "scratch"
}
