/**
 * The `edit` verb group: task METADATA (title, branch, command, status). Each
 * spec's own `group` field, not this file, decides where it lists; specs
 * spread into {@link VERBS}.
 */

import type { TaskStatus } from "../../types/task.ts"
import { F } from "./flags.ts"
import { daemonOf, simpleRpc } from "./handler-helpers.ts"
import { SET_COMMAND_VERB, SET_EFFORT_VERB, SET_MODEL_VERB } from "./handlers-engines.ts"
import { renameTabsSnapshot } from "./tab-snapshot.ts"
import { TASK_STATUSES } from "./task-statuses.ts"
import { ApiError, type VerbContext, type VerbSpec } from "./types.ts"

/**
 * `--tab` writes the snapshot, THEN broadcasts: the write is the whole rename
 * with no TUI attached; the broadcast stops an attached one overwriting the
 * file with the old name. `setTabTitle` is idempotent, so no request/reply
 * broker is needed (unlike `tab-close`).
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
  SET_MODEL_VERB,
  {
    name: "set-status",
    group: "edit",
    summary:
      "Set a task's lifecycle LABEL, and optionally record what the worker DELIVERED. The status half is cosmetic — the task row, its worktree, its branch and its engine session all stay exactly as they are, so `--status canceled` does NOT close, stop, or clean up anything. To end a task use `delete` (which keeps the git branch). The --report-* half writes `.report` on the task ({ branch?, pr?, summary?, at }), readable from `get-task` and `collect`: it is what the WORKER CLAIMS, and is deliberately not the same field as `.prStatus`, which the daemon POLLED from the forge — a worker can report a PR number that does not exist, and a dispatcher deciding whether to land needs to know which of the two it is reading. Report fields merge onto any previous report and restamp `at`, so a follow-up naming only --report-pr keeps the branch reported earlier.",
    flags: [
      F.taskId(),
      { name: "status", type: "enum", required: true, values: TASK_STATUSES, description: "New status." },
      {
        name: "report-branch",
        type: "string",
        placeholder: "B",
        description: "The branch the worker says holds the work (a CLAIM — `.branch` is the task's actual branch).",
      },
      {
        name: "report-pr",
        type: "int",
        placeholder: "N",
        description:
          "The PR number the worker says it opened (a CLAIM — `.prStatus.number` is what the daemon read from the forge).",
      },
      {
        name: "report-summary",
        type: "string",
        placeholder: "TEXT",
        description: "One line of what was delivered.",
      },
    ],
    handler: (ctx) =>
      simpleRpc(ctx, "task.status", {
        taskId: ctx.args.require("task-id"),
        status: ctx.args.requireEnum<TaskStatus>("status"),
        reportBranch: ctx.args.str("report-branch"),
        reportPr: ctx.args.int("report-pr"),
        reportSummary: ctx.args.str("report-summary"),
      }),
  },
]
