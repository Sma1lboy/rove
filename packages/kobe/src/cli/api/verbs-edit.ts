/**
 * The `edit` verb group — mutating task METADATA (title, branch, command,
 * status), as opposed to driving the running session (`drive`) or ending it
 * (`lifecycle`). One file per `VerbGroup`, mirroring the taxonomy
 * `rove api schema --group edit` prints — though it is each spec's own `group`
 * field, not this file, that decides where a verb lists. Specs spread back into the {@link VERBS} table, so
 * schema/help/validation see one canonical list.
 */

import type { TaskStatus } from "../../types/task.ts"
import { F } from "./flags.ts"
import { daemonOf, simpleRpc } from "./handler-helpers.ts"
import { SET_COMMAND_VERB, SET_EFFORT_VERB } from "./handlers-engines.ts"
import { renameTabsSnapshot } from "./tab-snapshot.ts"
import { TASK_STATUSES } from "./task-statuses.ts"
import { ApiError, type VerbContext, type VerbSpec } from "./types.ts"

/**
 * `rename` — the task's title, or with `--tab` one Terminal Tab's name.
 *
 * The tab half writes the persisted snapshot itself and THEN broadcasts.
 * Both halves are needed and neither is a fallback for the other: the write
 * is the entire rename when no TUI is attached, and the broadcast is what
 * makes an attached one repaint instead of holding the old name in memory
 * until its next tab mutation overwrites the file. They converge because
 * `setTabTitle` is idempotent — which is also why this needs no
 * request/reply broker, unlike `tab-close`, whose second run would kill PTYs.
 */
async function renameTaskOrTab(ctx: VerbContext): Promise<unknown> {
  const taskId = ctx.args.require("task-id")
  const title = ctx.args.require("title")
  const tabId = ctx.args.str("tab")
  if (tabId === undefined) return simpleRpc(ctx, "task.rename", { taskId, title })
  if (!renameTabsSnapshot(taskId, tabId, title)) {
    throw new ApiError(`task ${taskId} has no tab ${tabId}`, "TAB_NOT_FOUND", {
      hint: "`get-task` lists the addressable tab ids in .tabs[].id",
      nextCommandArgs: ["api", "get-task", "--task-id", taskId],
    })
  }
  const reply = await daemonOf(ctx).request<{ clients?: number }>("terminalTab.rename", { taskId, tabId, title })
  return { ok: true, taskId, tabId, title, renamed: true, clients: reply.clients ?? 0 }
}

export const EDIT_VERBS: readonly VerbSpec[] = [
  {
    name: "rename",
    group: "edit",
    summary:
      "Set a task's title, or with --tab one Terminal Tab's name — the API twin of the TUI's f2. Tab lifecycle is otherwise symmetric already (pane-open / tab-close / read-output --tab / send --tab), so naming was the one thing an agent could not do to a tab it had opened. An attached TUI repaints its tab strip; with none attached the persisted snapshot carries the name to the next mount.",
    flags: [
      F.taskId(),
      { name: "title", type: "string", required: true, placeholder: "T", description: "New title." },
      {
        name: "tab",
        type: "string",
        placeholder: "TAB",
        description:
          "Rename this Terminal Tab (id from `get-task` .tabs[].id, e.g. tab-2) instead of the task. TAB_NOT_FOUND when the task's snapshot names no such tab.",
      },
    ],
    handler: renameTaskOrTab,
  },
  {
    name: "set-branch",
    group: "edit",
    summary: "Rename a task's branch (git branch -m if materialized, else recorded).",
    flags: [
      F.taskId(),
      { name: "branch", type: "string", required: true, placeholder: "B", description: "New branch name." },
    ],
    handler: (ctx) =>
      simpleRpc(ctx, "task.setBranch", { taskId: ctx.args.require("task-id"), branch: ctx.args.require("branch") }),
  },
  SET_COMMAND_VERB,
  SET_EFFORT_VERB,
  {
    name: "set-status",
    group: "edit",
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
