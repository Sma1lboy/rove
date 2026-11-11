/**
 * Reading a task's worktree for review: its files, its changes, one file's
 * diff. Non-mutating, so they list under `read`. They run in the daemon that
 * owns the worktree, which is what lets a hub (`rove --web`, the bridge) show
 * the Files pane of a task on another machine: the call is forwarded there by
 * task id like any verb, and the git reads happen next to the files.
 */

import type { ApiParams, SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { forwardVerb, requireMachine } from "../../machines/forward.ts"
import { linkedWorktree } from "../../machines/remote-workspace.ts"
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

type Worktree = Awaited<ReturnType<typeof taskWorktree>>

/**
 * Run a read where the files are. A workspace on another machine (`add --workspace-on`) is a link
 * directory here, so the same verb runs on its worktree task there, with the `pass` flags as given.
 */
async function readWorktree<T>(
  ctx: VerbContext,
  verb: string,
  pass: readonly string[],
  here: (wt: Worktree) => T | Promise<T>,
): Promise<T> {
  const wt = await taskWorktree(ctx)
  const there = linkedWorktree(wt.path)
  if (!there) return here(wt)
  const given = pass.flatMap((name) => {
    const value = ctx.args.str(name)
    return value === undefined ? [] : [[name, value] as const]
  })
  const params: ApiParams = { "task-id": there.taskId, ...Object.fromEntries(given) }
  const envelope = await forwardVerb(requireMachine(there.machine), verb, params)
  if (!envelope.ok) {
    throw new ApiError(envelope.error.message, envelope.error.code, envelope.error.data as Record<string, unknown>)
  }
  return envelope.result as T
}

export const REVIEW_VERBS: readonly VerbSpec[] = [
  {
    name: "worktree-files",
    group: "read",
    summary:
      "List a task's worktree files: tracked plus untracked-not-ignored, worktree-relative. Returns { files }. Runs where the worktree lives, so it reads a task on another registered machine too.",
    flags: [F.taskId()],
    handler: (ctx) => readWorktree(ctx, "worktree-files", [], async (wt) => ({ files: await worktreeFiles(wt.path) })),
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
    handler: (ctx) =>
      readWorktree(ctx, "worktree-file", ["path"], (wt) => readPreviewFile(wt.path, ctx.args.require("path"))),
  },
  {
    name: "worktree-diff",
    group: "read",
    summary:
      "A task's changed files: committed on its branch against the base (`scope: branch`, PR base first), then uncommitted (`scope: working`). Returns { base, files[{ path, status, added, deleted, scope }] }; `base` is null when none resolves.",
    flags: [F.taskId()],
    handler: (ctx) => readWorktree(ctx, "worktree-diff", [], (wt) => worktreeDiff(wt.path, wt.prBaseRef)),
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
    handler: (ctx) =>
      readWorktree(ctx, "worktree-diff-file", ["path", "scope", "base", "ignore-whitespace"], (wt) => {
        const asked = ctx.args.require("scope")
        const scope = asked === "branch" || asked === "task" ? asked : "working"
        return worktreeDiffFile(wt.path, ctx.args.require("path"), scope, wt.prBaseRef, {
          ignoreWhitespace: ctx.args.bool("ignore-whitespace") === true,
          ...(ctx.args.str("base") ? { base: ctx.args.str("base") as string } : {}),
        })
      }),
  },
  {
    name: "worktree-refs",
    group: "read",
    summary:
      "What a task's diff can be compared against: its repository's local branches, remote branches and tags, plus the worktree branch's recent commits. Returns { branches, remotes, tags, commits[{ sha, subject }] }.",
    flags: [F.taskId()],
    handler: (ctx) => readWorktree(ctx, "worktree-refs", [], (wt) => worktreeRefs(wt.path)),
  },
]
