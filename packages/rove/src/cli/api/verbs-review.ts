/**
 * Reading a task's worktree for review: its files, its changes, one file's
 * diff. Non-mutating, so they list under `read`. They run in the daemon that
 * owns the worktree, which is what lets a hub (`rove --web`, the bridge) show
 * the Files pane of a task on another machine: the call is forwarded there by
 * task id like any verb, and the git reads happen next to the files.
 */

import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { readPreviewFile } from "../../worktree/file-read.ts"
import { worktreeDiff, worktreeDiffFile, worktreeFiles, worktreeRefs } from "../../worktree/review-read.ts"
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
    name: "worktree-file",
    group: "read",
    summary:
      "Read one previewable file of a task's worktree for a client to render: markdown, HTML, SVG, PNG/JPEG/GIF/WebP or PDF, at most 5 MB. Returns { path, mime, size, base64 }. Confined: a worktree-relative path whose real path (symlinks resolved) stays inside the worktree, else BAD_ARGS; any other type is NOT_PREVIEWABLE, a larger file TOO_LARGE. Runs where the worktree lives, so it reads a task on another registered machine too.",
    flags: [
      F.taskId(),
      {
        name: "path",
        type: "string",
        required: true,
        placeholder: "PATH",
        description: "Worktree-relative file path; absolute or `..` paths are refused.",
      },
    ],
    handler: async (ctx) => readPreviewFile((await taskWorktree(ctx)).path, ctx.args.require("path")),
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
      "One changed file's preview in a task's worktree: its uncommitted diff (`--scope working`), its committed diff against the base (`--scope branch`) or everything since the base, uncommitted and untracked work included (`--scope task`). Returns the Files pane's preview data (diff hunks, or the file for a code/binary view).",
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
        values: ["branch", "working", "task"],
        required: true,
        description:
          "`working` = uncommitted changes; `branch` = commits since the base; `task` = commits and uncommitted work since the base.",
      },
      {
        name: "base",
        type: "string",
        placeholder: "REF",
        description:
          "With `--scope task`: compare against this branch, tag or commit instead of the task's base. Refused (`BAD_REF`) when it is not a commit in the repository.",
      },
      {
        name: "ignore-whitespace",
        type: "bool",
        description: "Diff with `git diff -w`: whitespace-only changes drop out. Off by default.",
      },
    ],
    handler: async (ctx) => {
      const wt = await taskWorktree(ctx)
      const asked = ctx.args.require("scope")
      const scope = asked === "branch" || asked === "task" ? asked : "working"
      return worktreeDiffFile(wt.path, ctx.args.require("path"), scope, wt.prBaseRef, {
        ignoreWhitespace: ctx.args.bool("ignore-whitespace") === true,
        ...(ctx.args.str("base") ? { base: ctx.args.str("base") as string } : {}),
      })
    },
  },
  {
    name: "worktree-refs",
    group: "read",
    summary:
      "What a task's diff can be compared against: its repository's local branches, remote branches and tags, plus the worktree branch's recent commits. Returns { branches, remotes, tags, commits[{ sha, subject }] }.",
    flags: [F.taskId()],
    handler: async (ctx) => worktreeRefs((await taskWorktree(ctx)).path),
  },
]
