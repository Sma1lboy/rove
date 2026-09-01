/**
 * The `edit` verb group — mutating task METADATA (title, branch, command,
 * status), as opposed to driving the running session (`drive`) or ending it
 * (`lifecycle`). One file per `VERB_GROUPS` entry in `verbs.ts`, the taxonomy
 * `rove api schema --group edit` prints; a verb missing from that table
 * reports as group "other". Specs spread back into the {@link VERBS} table, so
 * schema/help/validation see one canonical list.
 */

import type { TaskStatus } from "../../types/task.ts"
import { F } from "./flags.ts"
import { simpleRpc } from "./handler-helpers.ts"
import { SET_COMMAND_VERB } from "./handlers-engines.ts"
import { TASK_STATUSES } from "./task-statuses.ts"
import type { VerbSpec } from "./types.ts"

export const EDIT_VERBS: readonly VerbSpec[] = [
  {
    name: "rename",
    summary: "Set a task's title.",
    flags: [F.taskId(), { name: "title", type: "string", required: true, placeholder: "T", description: "New title." }],
    handler: (ctx) =>
      simpleRpc(ctx, "task.rename", { taskId: ctx.args.require("task-id"), title: ctx.args.require("title") }),
  },
  {
    name: "set-branch",
    summary: "Rename a task's branch (git branch -m if materialized, else recorded).",
    flags: [
      F.taskId(),
      { name: "branch", type: "string", required: true, placeholder: "B", description: "New branch name." },
    ],
    handler: (ctx) =>
      simpleRpc(ctx, "task.setBranch", { taskId: ctx.args.require("task-id"), branch: ctx.args.require("branch") }),
  },
  SET_COMMAND_VERB,
  {
    name: "set-status",
    summary:
      "Set a task's lifecycle LABEL. Cosmetic — the task row, its worktree, its branch and its engine session all stay exactly as they are, so `--status canceled` does NOT close, stop, or clean up anything. To end a task use `delete` (which keeps the git branch).",
    flags: [
      F.taskId(),
      { name: "status", type: "enum", required: true, values: TASK_STATUSES, description: "New status." },
    ],
    handler: (ctx) =>
      simpleRpc(ctx, "task.status", {
        taskId: ctx.args.require("task-id"),
        status: ctx.args.requireEnum<TaskStatus>("status"),
      }),
  },
]
