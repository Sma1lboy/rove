/** `rove api tab-revive` — reopen a Terminal Tab whose session is gone. The open itself is `tab-revive.ts`. */

import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { hostedKeyFor } from "@sma1lboy/rove-daemon/daemon/pty-alias"
import { taskCwd } from "../../orchestrator/task-tree.ts"
import type { VendorId } from "../../types/vendor.ts"
import { F } from "./flags.ts"
import { daemonOf } from "./handler-helpers.ts"
import { ptyScopeOf } from "./pty-scope.ts"
import { ApiError, type VerbSpec } from "./types.ts"

export const TAB_REVIVE_VERB: VerbSpec = {
  name: "tab-revive",
  group: "drive",
  summary:
    "Reopen one Terminal Tab's own session when no PTY runs in it: a dead or freeze-restored tab, or one whose key the PTY host lost (a host restart that dropped its freeze records). A running tab is left alone (`revived: false, alive: true`). An engine tab resumes its persisted conversation (`resumed: true`) or, with none recorded, starts a fresh one with no first message — the task's original prompt is never replayed; it respects engine.maxLiveSessions. A shell or command tab runs its recorded command in the task's worktree. Refused: a tab id the task does not hold (TAB_NOT_FOUND), a split leaf (`tab-split --action reset` is its reopen), and viewport or preview tabs (TAB_NOT_REVIVABLE). A task on another registered machine runs there, like every verb. Returns { taskId, tabId, revived, resumed, sessionId? }.",
  flags: [
    F.taskId(true),
    {
      name: "tab",
      type: "string",
      required: true,
      placeholder: "TAB",
      description: "Exact Terminal Tab id from get-task .tabs[].id (for example tab-2).",
    },
  ],
  handler: async (ctx) => {
    const daemon = daemonOf(ctx)
    const taskId = ctx.args.require("task-id")
    const tabId = ctx.args.require("tab")
    if (tabId.includes("::")) {
      const [tab, ...leaf] = tabId.split("::")
      throw new ApiError(`${tabId} is a split pane, not a tab`, "BAD_FLAG", {
        taskId,
        hint: "reopen a split pane with `tab-split --action reset`",
        nextCommandArgs: [
          "api",
          "tab-split",
          "--task-id",
          taskId,
          "--tab",
          tab,
          "--action",
          "reset",
          "--leaf",
          leaf.join("::"),
        ],
      })
    }
    const { task } = await daemon.request<{ task: SerializedTask }>("task.get", { taskId })
    const scope = await ptyScopeOf(daemon, task)
    if (hostedKeyFor(taskId, tabId, scope) === null) {
      throw new ApiError(`tab ${tabId} on task ${taskId} belongs to a child task's conversation`, "TAB_NOT_FOUND", {
        taskId,
        tabId,
        hint: "address the child itself with its own --task-id (`list` shows the lineage)",
        nextCommandArgs: ["api", "get-task", "--task-id", taskId],
      })
    }
    const alias = scope.alias
    if (alias?.tabId === tabId) {
      throw new ApiError(`tab ${tabId} of task ${taskId} runs under task ${alias.taskId}`, "TAB_NOT_REVIVABLE", {
        taskId,
        tabId,
        hint: "revive it under the task that hosts the session",
        nextCommandArgs: ["api", "tab-revive", "--task-id", alias.taskId, "--tab", alias.tabId],
      })
    }
    const worktree = taskCwd(task)
    if (!worktree) throw new ApiError(`task ${taskId} has no worktree yet`, "NO_WORKTREE")
    const revived = await ctx.runtime.reviveTab(
      daemon,
      {
        id: taskId,
        worktreePath: worktree,
        kind: task.kind,
        vendor: task.vendor as VendorId | undefined,
        command: task.command,
        modelEffort: task.modelEffort,
        model: task.model,
        repo: task.repo,
      },
      tabId,
      worktree,
    )
    return { ok: true, taskId, tabId, ...revived }
  },
}
