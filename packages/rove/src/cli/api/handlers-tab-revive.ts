/** `rove api tab-revive` — reopen a Terminal Tab whose session is gone. The open itself is `tab-revive.ts`. */

import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { hostedKeyFor } from "@sma1lboy/rove-daemon/daemon/pty-alias"
import { taskCwd } from "../../orchestrator/task-tree.ts"
import type { VendorId } from "../../types/vendor.ts"
import { AT_REST_STATES, readActivityRegistry } from "./activity-view.ts"
import { F } from "./flags.ts"
import { daemonOf } from "./handler-helpers.ts"
import { ptyScopeOf } from "./pty-scope.ts"
import { taskEngineArgv } from "./tab-snapshot.ts"
import { ApiError, type VerbSpec } from "./types.ts"

export const TAB_REVIVE_VERB: VerbSpec = {
  name: "tab-revive",
  group: "drive",
  summary:
    "Reopen one Terminal Tab's own session when no PTY runs in it: a dead or freeze-restored tab, or one whose key the PTY host lost (a host restart that dropped its freeze records). A running tab is left alone (`revived: false, alive: true`). With --restart-exited, an engine tab whose session is alive but whose engine has exited (get-task .tabs[].engineAlive false: only the fallback shell is left) is closed and relaunched like a dead one; an engine still running, or a shell tab, is still left alone. With --restart-updated, an engine tab whose CLI was reinstalled after it started (get-task .tabs[].engineUpdated true) and that is at rest is relaunched the same way, onto the new version; one that is busy is left alone (`busy: <state>`). An engine tab resumes its persisted conversation (`resumed: true`) or, with none recorded, starts a fresh one with no first message — the task's original prompt is never replayed; it respects engine.maxLiveSessions. A shell or command tab runs its recorded command in the task's worktree. Refused: a tab id the task does not hold (TAB_NOT_FOUND), a split leaf (`tab-split --action reset` is its reopen), and viewport or preview tabs (TAB_NOT_REVIVABLE). A task on another registered machine runs there, like every verb. Returns { taskId, tabId, revived, resumed, sessionId?, busy? }.",
  flags: [
    F.taskId(true),
    {
      name: "tab",
      type: "string",
      required: true,
      placeholder: "TAB",
      description: "Exact Terminal Tab id from get-task .tabs[].id (for example tab-2).",
    },
    {
      name: "restart-exited",
      type: "bool",
      placeholder: "BOOL",
      description:
        "Also relaunch a tab whose engine exited inside a still-running session (keepAlive's fallback shell); without it that tab counts as running.",
    },
    {
      name: "restart-updated",
      type: "bool",
      placeholder: "BOOL",
      description:
        "Also relaunch an engine tab, resuming its conversation, whose engine CLI was reinstalled after it started (get-task .tabs[].engineUpdated true) — only while that tab is at rest (idle or turn_complete); a tab mid-turn, on a prompt, or of unknown state is left alone and reported as `busy`.",
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
    const restartExited = ctx.args.bool("restart-exited") === true
    const restartUpdated = ctx.args.bool("restart-updated") === true
    // Positive evidence only: the session is up, and a process walk finds no
    // engine in it, or finds one older than the CLI now installed.
    const row =
      restartExited || restartUpdated
        ? (
            await ctx.runtime.taskTabs(taskId, taskEngineArgv(task), scope, { engineUpdates: restartUpdated })
          ).tabs.find((t) => t.id === tabId && t.kind === "engine" && t.alive === true)
        : undefined
    const exited = restartExited && row?.engineAlive === false
    let busy: string | undefined
    if (!exited && restartUpdated && row?.engineUpdated === true) {
      // Relaunching kills the engine: never mid-turn or on a prompt, nor on an unknown state.
      const registry = await readActivityRegistry(daemon)
      const state = registry ? (registry.tabs[taskId]?.[tabId]?.state ?? "unknown") : "unknown"
      if (!AT_REST_STATES.has(state)) busy = state
      else if (!row.generation) busy = "unknown"
    }
    const updated = restartUpdated && row?.engineUpdated === true && busy === undefined
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
      { replaceExited: exited, ...(updated && row?.generation ? { restartUpdatedGeneration: row.generation } : {}) },
    )
    return { ok: true, taskId, tabId, ...revived, ...(busy ? { busy } : {}) }
  },
}
