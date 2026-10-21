/**
 * Reading a task's worktree for review: its files, its changes, one file's
 * diff. Non-mutating, so they list under `read`. They run in the daemon that
 * owns the worktree, which is what lets a hub (`rove --web`, the bridge) show
 * the Files pane of a task on another machine: the call is forwarded there by
 * task id like any verb, and the git reads happen next to the files.
 */

import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { worktreeDiff, worktreeDiffFile, worktreeFiles } from "../../worktree/review-read.ts"
import { F } from "./flags.ts"
import { daemonOf } from "./handler-helpers.ts"
import { ApiError, type VerbContext, type VerbSpec } from "./types.ts"

async function taskWorktree(ctx: VerbContext): Promise<{ path: string; prBaseRef?: string }> {
  const taskId = ctx.args.require("task-id")
  const { task } = await daemonOf(ctx).request<{ task: SerializedTask }>("task.get", { taskId })
  if (!task.worktreePath) {
    throw new ApiError(`task ${taskId} has no worktree yet`, "NO_WORKTREE", {
      hint: "materialize it first",
      nextCommandArgs: ["api", "ensure-worktree", "--task-id", taskId],
    })
  }
  return { path: task.worktreePath, prBaseRef: task.prStatus?.baseRef }
}

export const REVIEW_VERBS: readonly VerbSpec[] = [
  {
    name: "worktree-files",
    group: "read",
    summary:
      "List a task's worktree files: tracked plus untracked-not-ignored, worktree-relative. Returns { files }. Runs where the worktree lives, so it reads a task on another registered machine too.",
    flags: [F.taskId()],
    handler: async (ctx) => ({ files: await worktreeFiles((await taskWorktree(ctx)).path) }),
  },
  {
    name: "worktree-diff",
    group: "read",
    summary:
      "A task's changed files: committed on its branch against the base (`scope: branch`, PR base first), then uncommitted (`scope: working`). Returns { base, files[{ path, status, added, deleted, scope }] }; `base` is null when none resolves.",
    flags: [F.taskId()],
    handler: async (ctx) => {
      const wt = await taskWorktree(ctx)
      return worktreeDiff(wt.path, wt.prBaseRef)
    },
  },
  {
    name: "worktree-diff-file",
    group: "read",
    summary:
      "One changed file's preview in a task's worktree: its uncommitted diff (`--scope working`) or its whole branch diff against the base (`--scope branch`). Returns the Files pane's preview data (diff hunks, or the file for a code/binary view).",
    flags: [
      F.taskId(),
      {
        name: "path",
        type: "string",
        required: true,
        placeholder: "PATH",
        description: "Worktree-relative file path; absolute or `..` paths are refused.",
      },
      {
        name: "scope",
        type: "enum",
        values: ["branch", "working"],
        required: true,
        description: "`working` = uncommitted changes; `branch` = everything since the base.",
      },
    ],
    handler: async (ctx) => {
      const wt = await taskWorktree(ctx)
      const scope = ctx.args.require("scope") === "branch" ? "branch" : "working"
      return worktreeDiffFile(wt.path, ctx.args.require("path"), scope, wt.prBaseRef)
    },
  },
]
