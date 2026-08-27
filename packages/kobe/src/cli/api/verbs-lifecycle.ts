/**
 * The `lifecycle` verb group — archive, pin, land, delete. Split out of
 * `verbs.ts` (file-size cap); spread back into the {@link VERBS} table there,
 * so schema/help/validation see one canonical list.
 */

import { F } from "./flags.ts"
import { simpleRpc } from "./handler-helpers.ts"
import { archive, deleteTask, land } from "./handlers-tasks.ts"
import type { VerbSpec } from "./types.ts"

export const LIFECYCLE_VERBS: readonly VerbSpec[] = [
  {
    name: "archive",
    summary: "Archive (or with --archived=false, unarchive) a task. Non-destructive: worktree/branch/history stay.",
    flags: [
      F.taskId(),
      { name: "archived", type: "bool", default: "true", description: "true to archive, false to unarchive." },
    ],
    handler: archive,
  },
  {
    name: "pin",
    summary: "Pin (or with --pinned=false, unpin) a task to the top of the sidebar.",
    flags: [F.taskId(), { name: "pinned", type: "bool", default: "true", description: "true to pin, false to unpin." }],
    handler: (ctx) =>
      simpleRpc(ctx, "task.pin", {
        taskId: ctx.args.require("task-id"),
        pinned: ctx.args.bool("pinned") ?? true,
      }),
  },
  {
    name: "land",
    summary:
      "Merge a task's branch back into its base repo's current branch. Refuses a dirty base checkout and refuses a branch with zero commits ahead of the base (EMPTY_BRANCH; EMPTY_BRANCH_DIRTY_WORKTREE with a send-back recovery path when the worktree still holds the uncommitted work). On conflict, aborts and returns the conflicted files (resolve by hand). Returns { landedOn, commit }.",
    flags: [
      F.taskId(),
      {
        name: "strategy",
        type: "enum",
        values: ["merge", "squash"],
        default: "merge",
        description: "merge (--no-ff) or squash into one commit.",
      },
      { name: "delete-branch", type: "bool", description: "Delete the task's branch after a successful land." },
      { name: "then-archive", type: "bool", description: "Archive the task after a successful land." },
      {
        name: "remove-worktree",
        type: "bool",
        default: "true",
        description:
          "Remove the task's worktree after a successful land (default; the branch always stays). Pass --remove-worktree=false to keep it. Dirty worktrees, the base checkout, and the caller's own worktree are refused — the outcome is reported in the result's `worktree` field, never thrown.",
      },
    ],
    handler: land,
  },
  {
    name: "delete",
    summary:
      "Remove a task and its worktree; the git branch stays unless --delete-branch. Needs --force on a dirty worktree.",
    flags: [
      F.taskId(),
      {
        name: "force",
        type: "bool",
        description: "Delete even with uncommitted changes (never implies --delete-branch).",
      },
      { name: "delete-branch", type: "bool", description: "Also delete the task's git branch (default: keep it)." },
    ],
    handler: deleteTask,
  },
]
