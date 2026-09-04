/**
 * The `lifecycle` verb group — pin, land, delete: the verbs that end a task's
 * life or decide it survives, which is why they are worth naming apart from
 * the metadata edits next door. One file per `VerbGroup`, mirroring the
 * taxonomy `rove api schema --group lifecycle` prints — though it is each
 * spec's own `group` field, not this file, that decides where a verb lists.
 * Specs spread back into the
 * {@link VERBS} table, so schema/help/validation see one canonical list.
 */

import { F } from "./flags.ts"
import { simpleRpc } from "./handler-helpers.ts"
import { deleteTask, land } from "./handlers-tasks.ts"
import type { VerbSpec } from "./types.ts"

export const LIFECYCLE_VERBS: readonly VerbSpec[] = [
  {
    name: "pin",
    group: "lifecycle",
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
    group: "lifecycle",
    summary:
      "Merge a task's branch back into its base repo's current branch. Refuses a dirty base checkout, a branch that no longer resolves in the base repo (MISSING_REF — renamed or deleted outside Rove), and a branch with zero commits ahead of the base (EMPTY_BRANCH; EMPTY_BRANCH_DIRTY_WORKTREE with a send-back recovery path when the worktree still holds the uncommitted work). On conflict, aborts and returns the conflicted files (resolve by hand). Returns { landedOn, commit }.",
    flags: [
      F.taskId(),
      {
        name: "strategy",
        type: "enum",
        values: ["merge", "squash"],
        default: "merge",
        description: "merge (--no-ff) or squash into one commit.",
      },
      {
        name: "delete-branch",
        type: "bool",
        description:
          "Delete the task's branch after a successful land. Uses `git branch -D`, which drops the branch's reflog too; with --strategy squash the base's new commit does not reach the branch's own commits, so Rove first anchors the tip at refs/rove/salvage/<branch>-<stamp> and returns it as `branchAnchor`. Requires the worktree to be gone: git refuses to delete a branch a live worktree has checked out, so a land that kept the worktree keeps the branch too and says so in `branchKept`.",
      },
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
    group: "lifecycle",
    summary:
      "Remove a task and its worktree; the git branch stays unless --delete-branch. Needs --force on a dirty worktree. Returns { queued } — removal itself runs in the background; add --wait for the resolved outcome.",
    flags: [
      F.taskId(),
      {
        name: "force",
        type: "bool",
        description: "Delete even with uncommitted changes (never implies --delete-branch).",
      },
      { name: "delete-branch", type: "bool", description: "Also delete the task's git branch (default: keep it)." },
      {
        name: "wait",
        type: "bool",
        description:
          "Follow the background removal and report its OUTCOME (removed / failed / pending) instead of returning as soon as it is queued.",
      },
    ],
    handler: deleteTask,
  },
]
