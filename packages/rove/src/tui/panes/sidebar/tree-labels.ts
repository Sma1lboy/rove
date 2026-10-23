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
 * The name of the task's one engine conversation: a migrated child reads its
 * parent's aliased tab, any other task its first named engine tab. Absent
 * until the engine has named the session.
 */
export function conversationTitleOf(
  task: Task,
  tabsByTask: ReadonlyMap<string, readonly { readonly id: string; readonly title?: string }[]>,
): string | undefined {
  const alias = task.ptyAlias
  const tabs = tabsByTask.get(alias?.taskId ?? task.id)
  if (!tabs) return undefined
  if (alias) return tabs.find((tab) => tab.id === alias.tabId)?.title
  return tabs.find((tab) => tab.title !== undefined)?.title
}

/**
 * A row is a conversation, so it is named like one: the engine session's own
 * title (`liveTitle`, from {@link conversationTitleOf}), else the task's
 * title, else its branch. The task title only names `task` rows and children:
 * a `main` row reads its live HEAD, and a `dir` row its tail-truncated
 * directory (stored dir titles are auto-generated noise like `jacksonc-xxxx`,
 * and this needs no data migration). Then the path; then "scratch", never
 * blank. The branch stays searchable (`tree-search.ts`).
 *
 * `liveBranch` is the caller-resolved HEAD for branchless rows
 * ({@link rowLiveBranchPath}, `git-head.ts`); `home` is injectable for tests.
 */
export function worktreeRowLabel(
  task: Task,
  opts: { readonly liveBranch?: string; readonly liveTitle?: string; readonly home?: string } = {},
): string {
  const live = opts.liveTitle?.trim()
  if (live) return live
  const title = task.title.trim()
  if (title && (task.parentTaskId !== undefined || task.kind === "task")) return title
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
