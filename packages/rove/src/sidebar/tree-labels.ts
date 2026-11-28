/**
 * What a worktree row is called — a per-task derivation the row renderer calls
 * directly, kept out of `tree-core.ts` (which re-exports it) so the tree
 * builder isn't in scope.
 */

import { homedir } from "node:os"
import type { Task } from "@/types/task"
import { tildify } from "../lib/path-home"
import { truncateStart } from "../lib/truncate"
import { repoBasename } from "./groups"

/** Widest path label a worktree row renders before tail-truncation — the
 *  default rail width minus row chrome. The row's flex still end-clips on
 *  narrower rails; pre-truncating from the START keeps the leaf visible at
 *  the default width, which is the half that disambiguates a path. */
const PATH_LABEL_MAX = 24

/**
 * The checkout whose live HEAD names this row, or `""` when the row stores its
 * own branch. A `dir` row stores none and moves freely; a scratch shell
 * opened inside a repo IS on a branch and should read like its sibling rows.
 * Not-a-repo falls back to the path (the poller answers `""`).
 */
export function rowLiveBranchPath(task: Task): string {
  if (task.kind !== "dir") return ""
  return task.worktreePath || task.repo || ""
}

/** The `<dir>-xxxx` title `openDirectoryTaskRow` mints when no title is given. */
const AUTO_DIR_TITLE = /^\S+-[0-9a-z]{4}$/

/** A `dir` title a person or a prompt gave, not the repo's name (an adopted scratch) or the auto-minted `<dir>-xxxx`. */
export function isNamedDir(task: Task): boolean {
  const title = task.title.trim()
  return task.kind === "dir" && title !== repoBasename(task.repo) && !AUTO_DIR_TITLE.test(title)
}

/**
 * A row is named by its task's title (the newest name reported: the first
 * prompt, the engine's own title, a rename), else its branch. The task title names `task` rows and children; a
 * `dir` row reads its live HEAD, else its tail-truncated directory, unless it
 * was named (a prompt-derived or renamed
 * title; the auto-minted `jacksonc-xxxx` and repo-name titles are noise, and
 * this needs no data migration). Then the path; then
 * "scratch", never blank. The branch stays searchable (`tree-search.ts`).
 *
 * `liveBranch` is the caller-resolved HEAD for branchless rows
 * ({@link rowLiveBranchPath}, `git-head.ts`); `home` is injectable for tests.
 */
export function worktreeRowLabel(
  task: Task,
  opts: { readonly liveBranch?: string; readonly home?: string } = {},
): string {
  const title = task.title.trim()
  const namedDir = isNamedDir(task)
  if (title && (task.parentTaskId !== undefined || task.kind === "task" || namedDir)) return title
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
