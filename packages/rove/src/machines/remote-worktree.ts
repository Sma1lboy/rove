/**
 * A task's worktree read on the machine that has it: the `worktree-files`,
 * `worktree-diff` and `worktree-diff-file` verbs, forwarded. The TUI's file
 * tree and preview use this for a task on another machine, where the worktree
 * path names nothing on this disk.
 */

import type { ApiParams } from "@sma1lboy/rove-daemon/daemon/protocol"
import type { PreviewData } from "../tui/ops/preview-core.ts"
import type { StatusEntry } from "../tui/panes/filetree/git.ts"
import type { DiffScope, WorktreeDiff } from "../worktree/review-read.ts"
import { forwardVerb, requireMachine } from "./forward.ts"

async function remoteVerb<T>(alias: string, verb: string, params: ApiParams): Promise<T> {
  const envelope = await forwardVerb(requireMachine(alias), verb, params)
  if (!envelope.ok) throw new Error(envelope.error.message)
  return envelope.result as T
}

export async function remoteFiles(alias: string, taskId: string): Promise<string[]> {
  return (await remoteVerb<{ files: string[] }>(alias, "worktree-files", { "task-id": taskId })).files
}

/** One scope of the changes, shaped as the file tree's status rows (flat: the remote already flattened them). */
export async function remoteChanges(
  alias: string,
  taskId: string,
  scope: DiffScope,
): Promise<{ base: string | null; entries: StatusEntry[] }> {
  const diff = await remoteVerb<WorktreeDiff>(alias, "worktree-diff", { "task-id": taskId })
  const entries = diff.files
    .filter((row) => row.scope === scope)
    .map(
      (row): StatusEntry => ({
        path: row.path,
        status: row.status as StatusEntry["status"],
        added: row.added,
        deleted: row.deleted,
      }),
    )
  return { base: diff.base, entries }
}

export function remotePreview(alias: string, taskId: string, relPath: string, base?: string): Promise<PreviewData> {
  return remoteVerb<PreviewData>(alias, "worktree-diff-file", {
    "task-id": taskId,
    path: relPath,
    scope: base ? "branch" : "working",
  })
}
