/**
 * What a worktree row is called — a per-task derivation the row renderer calls
 * directly, kept out of `tree-core.ts` (which re-exports it) so the tree
 * builder isn't in scope.
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
 * The checkout whose live HEAD names this row, or `""` when the row stores its
 * own branch. `main` and `dir` store none and move freely; a scratch shell
 * opened inside a repo IS on a branch and should read like its sibling rows.
 * Not-a-repo falls back to the path (the poller answers `""`).
 */
export function rowLiveBranchPath(task: Task): string {
  if (task.kind !== "main" && task.kind !== "dir") return ""
  return task.worktreePath || task.repo || ""
}

/**
 * Branch if any; a branchless `dir` task by its tail-truncated directory
 * (stored title ignored — dir titles are auto-generated noise like
 * `jacksonc-xxxx`, and this needs no data migration); a regular task before
 * its worktree exists by its title; then the path; then "scratch", never blank.
 *
 * `liveBranch` is the caller-resolved HEAD for branchless rows
 * ({@link rowLiveBranchPath}, `git-head.ts`); `home` is injectable for tests.
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
