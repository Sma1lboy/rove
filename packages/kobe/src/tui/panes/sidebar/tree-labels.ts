/**
 * What a worktree row is CALLED.
 *
 * Split from `tree-core.ts` (which decides what rows exist) because this is a
 * derivation over ONE task, with its own rule and its own edge cases — and
 * because the row renderer calls it directly, per row, without wanting the
 * tree builder in scope.
 *
 * `tree-core.ts` re-exports both functions, so importers keep their path.
 */

import { homedir } from "node:os"
import type { Task } from "@/types/task"
import { tildify } from "../../../lib/path-home"
import { truncateStart } from "../../lib/truncate"

/** Widest path label a worktree row renders before tail-truncation — the
 *  default rail width minus row chrome. The row's flex still end-clips on
 *  narrower rails; pre-truncating from the START keeps the leaf visible at
 *  the default width, which is the half that disambiguates a path. */
const PATH_LABEL_MAX = 24

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

/**
 * The one derivation rule: a task with a branch is named by it; a branchless
 * `dir` task (plain `rove .` opens and scratch shells alike) by its
 * tail-truncated directory — the stored title is deliberately ignored there,
 * because dir-task titles are auto-generated noise (`jacksonc-xxxx`) and
 * existing rows render by this rule with no data migration. A regular task
 * before its worktree materialises (no branch yet, path not its own) keeps its
 * title, else the label falls back to the path and finally "scratch" so a row
 * is never blank.
 *
 * `liveBranch` is the caller-resolved HEAD for the rows that own no branch of
 * their own (see {@link rowLiveBranchPath} and `git-head.ts`); `home` is
 * injectable so the tildification unit-tests without the real $HOME.
 */
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
    const tildified = tildify(path, home)
    return truncateStart(tildified, PATH_LABEL_MAX)
  }
  return task.title || "scratch"
}
