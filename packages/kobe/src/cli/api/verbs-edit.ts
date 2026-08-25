/**
 * The `edit` verb group — mutating task metadata. Split out of `verbs.ts`
 * (file-size cap); spread back into the {@link VERBS} table there, so
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
    summary: "Set a task's lifecycle status.",
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
