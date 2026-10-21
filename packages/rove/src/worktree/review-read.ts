/**
 * What a reviewer reads from a task's worktree: its file list, its changed
 * files against the task's base, and one file's diff preview. One
 * implementation for every surface — the bridge reads a local task's worktree
 * through it, and the `worktree-files` / `worktree-diff` / `worktree-diff-file`
 * verbs run it inside the daemon that owns the worktree, which is how a hub
 * reads a task on another machine.
 */

import { isAbsolute, normalize } from "node:path"
import { ApiError } from "../cli/api/types.ts"
import { type PreviewData, loadPreviewData } from "../tui/ops/preview-core.ts"
import { type StatusEntry, listFiles, resolveBase, statusFiles, statusFilesBranch } from "../tui/panes/filetree/git.ts"

export type DiffScope = "branch" | "working"

/** One changed file, flattened out of the TUI's collapsible status tree. */
export interface DiffFileRow {
  readonly path: string
  readonly status: string
  readonly added: number | null
  readonly deleted: number | null
  readonly scope: DiffScope
}

export interface WorktreeDiff {
  /** The ref branch changes are measured against; null when none resolves. */
  readonly base: string | null
  readonly files: readonly DiffFileRow[]
}

function flatten(entries: readonly StatusEntry[], scope: DiffScope): DiffFileRow[] {
  return entries.flatMap((e): DiffFileRow[] =>
    e.children?.length
      ? flatten(e.children, scope)
      : [{ path: e.path, status: e.status, added: e.added ?? null, deleted: e.deleted ?? null, scope }],
  )
}

/** Tracked plus untracked-not-ignored files, worktree-relative. */
export function worktreeFiles(worktreePath: string): Promise<string[]> {
  return listFiles(worktreePath)
}

/** Committed-on-branch changes against the base, then uncommitted ones — the TUI changes pane's base ladder (PR base first). */
export async function worktreeDiff(worktreePath: string, prBaseRef?: string): Promise<WorktreeDiff> {
  const base = await resolveBase(worktreePath, prBaseRef)
  const [branch, working] = await Promise.all([
    base ? statusFilesBranch(worktreePath, base) : Promise.resolve([]),
    statusFiles(worktreePath),
  ])
  return { base, files: [...flatten(branch, "branch"), ...flatten(working, "working")] }
}

/** git scopes a diff to the worktree, but a `code` preview reads the file itself: only a path inside it. */
export function isWorktreeRelative(path: string): boolean {
  return !isAbsolute(path) && !normalize(path).split(/[\\/]/).includes("..")
}

/** One file's preview: its working-tree diff, or its whole branch diff against the base. */
export async function worktreeDiffFile(
  worktreePath: string,
  path: string,
  scope: DiffScope,
  prBaseRef?: string,
): Promise<PreviewData> {
  if (!isWorktreeRelative(path)) throw new ApiError("path must be relative to the worktree", "BAD_ARGS")
  if (scope === "working") return loadPreviewData(worktreePath, path)
  const base = await resolveBase(worktreePath, prBaseRef)
  if (!base) throw new ApiError("could not resolve a base branch for this task", "NO_BASE")
  return loadPreviewData(worktreePath, path, { base })
}
