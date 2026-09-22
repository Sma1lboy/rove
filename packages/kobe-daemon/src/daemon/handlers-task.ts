/**
 * `task.*` (+ `project.forget`) RPC handlers, spread into the registry by
 * `handlers.ts`. Grouped by wire-name prefix only. The wire-compat contract in
 * `handlers.ts` (byte-equivalent payloads, key order load-bearing) applies.
 */

import { logDaemonError } from "./crash-log.ts"
import { optionalBoolean, optionalNumber, optionalString, optionalVendor, requireString } from "./handler-validators.ts"
import { publishIssueSnapshot } from "./handlers-issues.ts"
import type { DaemonHandlerContext, DaemonRequestHandler } from "./handlers.ts"
import { serializeTask } from "./protocol.ts"
import { auditDeletionRequested } from "./task-deletion-audit.ts"

/**
 * `set-status --report-*` fields, or undefined when none were sent — never an
 * empty report, which would restamp `at` as if the worker reported again.
 */
function optionalWorkerReport(
  payload: Record<string, unknown>,
): { branch?: string; pr?: number; summary?: string } | undefined {
  const branch = optionalString(payload, "reportBranch")
  const summary = optionalString(payload, "reportSummary")
  const pr = optionalNumber(payload, "reportPr")
  if (branch === undefined && summary === undefined && pr === undefined) return undefined
  return {
    ...(branch !== undefined ? { branch } : {}),
    ...(pr !== undefined ? { pr } : {}),
    ...(summary !== undefined ? { summary } : {}),
  }
}

export const TASK_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    name: "task.list",
    handle(_payload, ctx: DaemonHandlerContext) {
      // `activeTaskId` is the implicit target when `--task-id` is omitted;
      // listing it makes a misdirected delivery auditable. Test doubles may
      // not stub the signal, so absence reads as "no focus".
      return {
        tasks: ctx.orch.listTasks().map(serializeTask),
        activeTaskId: ctx.orch.activeTaskSignal?.()?.() ?? null,
      }
    },
  },
  {
    name: "task.get",
    handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const task = ctx.orch.getTask(taskId)
      if (!task) throw new Error(`task not found: ${taskId}`)
      return { task: serializeTask(task) }
    },
  },
  {
    name: "task.create",
    async handle(payload, ctx) {
      const repo = requireString(payload, "repo")
      // The CLI sends its $KOBE_TASK_ID/$KOBE_TAB_ID (the daemon has no caller
      // env). Recorded only with a task id; tab defaults to tab-1.
      const dispatcherTaskId = optionalString(payload, "dispatcherTaskId")
      const dispatcher = dispatcherTaskId
        ? { taskId: dispatcherTaskId, tabId: optionalString(payload, "dispatcherTabId") || "tab-1" }
        : undefined
      const task = await ctx.orch.createTask({
        repo,
        title: optionalString(payload, "title"),
        branch: optionalString(payload, "branch"),
        baseRef: optionalString(payload, "baseRef"),
        worktreeName: optionalString(payload, "worktreeName"),
        vendor: optionalVendor(payload, "vendor"),
        command: optionalString(payload, "command"),
        modelEffort: optionalString(payload, "effort"),
        model: optionalString(payload, "model"),
        tier: optionalString(payload, "tier"),
        groupId: optionalString(payload, "groupId"),
        dispatcher,
      })
      return { taskId: task.id, task: serializeTask(task) }
    },
  },
  {
    name: "task.rename",
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      await ctx.orch.setTitle(taskId, requireString(payload, "title"))
      return {}
    },
  },
  {
    name: "task.setBranch",
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      await ctx.orch.setBranch(taskId, requireString(payload, "branch"))
      return {}
    },
  },
  {
    name: "task.observeLanguage",
    async handle(payload, ctx) {
      // The orchestrator decides what the text says; text with no signal
      // writes nothing, so a bare "ok" can't erase what a paragraph established.
      const taskId = requireString(payload, "taskId")
      const text = requireString(payload, "text")
      await ctx.orch.observeLanguage(taskId, text)
      return {}
    },
  },
  {
    name: "task.setVendor",
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const vendor = optionalVendor(payload, "vendor")
      if (!vendor) throw new Error("task.setVendor: vendor is required")
      // Not `optionalString`: that maps `""` to undefined, and `""` is the
      // wire spelling of "clear the level". Absent stays absent.
      const rawEffort = payload.effort
      if (rawEffort !== undefined && typeof rawEffort !== "string") throw new Error("effort must be a string")
      const rawModel = payload.model
      if (rawModel !== undefined && typeof rawModel !== "string") throw new Error("model must be a string")
      await ctx.orch.setVendor(taskId, vendor, rawEffort, rawModel)
      return {}
    },
  },
  {
    name: "task.setCommand",
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      // The caller resolves the protocol: presets live in kobe's state.json,
      // which the daemon cannot read. Absent = keep the task's current one.
      await ctx.orch.setCommand(taskId, requireString(payload, "command"), optionalVendor(payload, "vendor"))
      return {}
    },
  },
  {
    name: "task.delete",
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const force = optionalBoolean(payload, "force")
      const deleteBranch = optionalBoolean(payload, "deleteBranch")
      // Audit before `prepareTaskDeletion`, which can throw: refusals get
      // recorded too. Read the task now; the runner removes it from the index.
      const task = ctx.orch.getTask(taskId)
      const byTaskId = optionalString(payload, "requestedByTaskId")
      auditDeletionRequested(
        taskId,
        task,
        {
          clientId: ctx.clientId,
          ...(byTaskId
            ? { requestedBy: { taskId: byTaskId, tabId: optionalString(payload, "requestedByTabId") || "tab-1" } }
            : {}),
        },
        { force, deleteBranch },
      )
      const accepted = await ctx.orch.prepareTaskDeletion(taskId, { force, deleteBranch })
      ctx.activity.clearTask(taskId)
      // The one lifecycle action allowed to cascade durable Inbox episodes.
      await ctx.inbox.deleteTaskBestEffort(taskId)
      // The issue owns the link (`Issue.taskId`); nothing else clears it, so the
      // card would show In progress forever. Best-effort: the deletion already
      // committed, so failures are logged, never a failed delete.
      if (task) {
        try {
          const next = await ctx.issues.unlinkTask(task.repo, taskId)
          if (next) publishIssueSnapshot(ctx, next)
        } catch (err) {
          logDaemonError("issue-delete-unlink", err)
        }
      }
      if (accepted) ctx.deletions.enqueue(taskId)
      // Removal runs in the background (teardown can take tens of seconds), so
      // this reports only that the request was taken. `queued: false`: no such
      // task id, nothing will ever run.
      return { taskId, queued: accepted }
    },
  },
  {
    // Read-only git reads (HEAD, status, rev-list; worktree status only at
    // count zero), milliseconds. Not `blocking`, which would drop the client
    // deadline; the land confirm awaits it inline.
    name: "task.landPreflight",
    async handle(payload, ctx) {
      return { result: await ctx.orch.landPreflight(requireString(payload, "taskId")) }
    },
  },
  {
    name: "task.land",
    blocking: true,
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const strategy = optionalString(payload, "strategy") === "squash" ? "squash" : "merge"
      const result = await ctx.orch.landTask(taskId, {
        strategy,
        deleteBranch: optionalBoolean(payload, "deleteBranch") === true,
        // Absent → orchestrator default (remove); only explicit `false` keeps it.
        removeWorktree: optionalBoolean(payload, "removeWorktree"),
        callerCwd: optionalString(payload, "callerCwd"),
      })
      // landTask throws on refusal/conflict, so reaching here means it landed.
      ctx.plugins?.handleUiReport({
        kind: "task.landed",
        taskId,
        detail: { strategy: result.strategy, landedOn: result.landedOn, commit: result.commit },
      })
      return { result }
    },
  },
  {
    name: "task.syncBase",
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const task = ctx.orch.getTask(taskId)
      if (!task?.worktreePath) throw new Error("task has no worktree to sync")
      // Throws `SYNC_CONFLICT: <files>` / `SYNC_WORKTREE_DIRTY`; callers match
      // the marker as for `LAND_CONFLICT`.
      return { result: await ctx.runtime.syncWorktreeWithBase(task.worktreePath, task.baseRef) }
    },
  },
  {
    name: "task.pin",
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      await ctx.orch.setPinned(taskId, optionalBoolean(payload, "pinned"))
      return {}
    },
  },
  {
    name: "task.move",
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const direction = requireString(payload, "direction")
      if (direction !== "up" && direction !== "down") throw new Error("direction must be up or down")
      await ctx.orch.moveTask(taskId, direction === "up" ? -1 : 1)
      return {}
    },
  },
  {
    name: "task.status",
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const status = requireString(payload, "status")
      if (!ctx.runtime.isTaskStatus(status)) throw new Error("status must be a TaskStatus")
      // Capture repo + prior status before the transition, for the mirror below.
      const linked = status === "done" ? ctx.orch.getTask(taskId) : undefined
      const prevStatus = linked?.status
      await ctx.orch.setStatus(taskId, status)
      // After the status, so a report never lands on a refused transition.
      const report = optionalWorkerReport(payload)
      if (report) await ctx.orch.setWorkerReport(taskId, report)
      // Mirror →done onto the linked issue. Lookup and flip run under one
      // issue-store lock so a concurrent reopen isn't clobbered. Only on a real
      // transition, so re-firing done never re-clobbers a manually reopened
      // issue. The status already committed: failures are logged, not thrown.
      if (status === "done" && prevStatus !== "done" && linked) {
        try {
          const next = await ctx.issues.mirrorTaskDone(linked.repo, taskId)
          if (next) publishIssueSnapshot(ctx, next)
        } catch (err) {
          logDaemonError("issue-done-mirror", err)
        }
      }
      return {}
    },
  },
  {
    name: "task.openDir",
    async handle(payload, ctx) {
      const dir = requireString(payload, "dir")
      const task = await ctx.orch.openDirectoryTask({
        dir,
        vendor: optionalVendor(payload, "vendor"),
        scratch: optionalBoolean(payload, "scratch"),
      })
      return { taskId: task.id, task: serializeTask(task) }
    },
  },
  {
    // No-op on non-scratch rows.
    name: "task.adoptScratchRepo",
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      await ctx.orch.adoptScratchRepo(taskId, requireString(payload, "repo"))
      return {}
    },
  },
  {
    name: "task.ensureMain",
    blocking: true,
    async handle(payload, ctx) {
      const repo = requireString(payload, "repo")
      const task = await ctx.orch.ensureMainTask(repo)
      return { task: serializeTask(task) }
    },
  },
  {
    name: "project.forget",
    async handle(payload, ctx) {
      const repo = requireString(payload, "repo")
      await ctx.orch.forgetProject(repo)
      return {}
    },
  },
  {
    name: "task.ensureWorktree",
    blocking: true,
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      // `git worktree add` is minute-class on a huge repo and callers need the
      // path, so the RPC blocks and progress goes to every pane via `task.jobs`.
      // A terminal phase is published ALWAYS, even on throw: the bus replays
      // the last value, so late subscribers would see `running` forever.
      ctx.bus.publish("task.jobs", { taskId, kind: "ensureWorktree", phase: "running" })
      try {
        const path = await ctx.orch.ensureWorktree(taskId)
        ctx.bus.publish("task.jobs", { taskId, kind: "ensureWorktree", phase: "done" })
        return { worktreePath: path }
      } catch (err) {
        ctx.bus.publish("task.jobs", {
          taskId,
          kind: "ensureWorktree",
          phase: "error",
          error: err instanceof Error ? err.message : String(err),
        })
        throw err
      }
    },
  },
  {
    // Callers write only a prompt already sent to an engine (CLI `add` after
    // delivery confirms; TUI "Run again" copying onto its fork), so `get-task`
    // never shows a brief that was merely composed.
    name: "task.setPrompt",
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      await ctx.orch.setPrompt(taskId, requireString(payload, "prompt"))
      return {}
    },
  },
  {
    name: "task.setActive",
    async handle(payload, ctx) {
      // Also touches updatedAt so "recent" sorting reflects use. The bus caches
      // the last value, so late-subscribing panes get the current focus.
      const taskId = optionalString(payload, "taskId") ?? null
      await ctx.orch.setActiveTask(taskId)
      ctx.bus.publish("active-task", { taskId })
      return {}
    },
  },
]
