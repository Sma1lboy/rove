/**
 * `task.*` (+ `project.forget`) RPC handlers, spread into the registry by
 * `handlers.ts`. Grouped by wire-name prefix only. The wire-compat contract in
 * `handlers.ts` (byte-equivalent payloads, key order load-bearing) applies.
 */

import { isBuiltinModInstalled } from "../plugins/builtin-mods.ts"
import { pickRepos, subtreeIds } from "../task-tree.ts"
import type { DaemonTask } from "./contracts.ts"
import { logDaemonError } from "./crash-log.ts"
import {
  objectPayload,
  optionalBoolean,
  optionalNumber,
  optionalString,
  optionalVendor,
  requireString,
} from "./handler-validators.ts"
import { publishIssueSnapshot } from "./handlers-issues.ts"
import type { DaemonHandlerContext, DaemonRequestHandler } from "./handlers.ts"
import { serializeTask } from "./protocol.ts"
import { teardownScope } from "./pty-alias.ts"
import { syncRepos } from "./sync-repos.ts"
import { auditDeletionRequested } from "./task-deletion-audit.ts"

/** Engine states that mean someone is mid-work: archiving would hide a row that still needs eyes. */
const ENGINE_BUSY: ReadonlySet<string> = new Set(["running", "permission_needed"])

/**
 * Everything outside the index that hangs off a task being deleted: activity,
 * Inbox episodes, gates, and the issue link.
 */
async function releaseDeletedTask(
  ctx: DaemonHandlerContext,
  taskId: string,
  task: DaemonTask | undefined,
): Promise<void> {
  ctx.activity.clearTask(taskId)
  // The one lifecycle action allowed to cascade durable Inbox episodes.
  await ctx.inbox.deleteTaskBestEffort(taskId)
  await ctx.gates.withdrawTask(taskId).catch((err) => logDaemonError("gates-withdraw-task", err))
  // The issue owns the link (`Issue.taskId`); nothing else clears it, so the
  // card would show In progress forever. Best-effort: the deletion already
  // committed, so failures are logged, never a failed delete.
  // Without the Kanban mod the store stays as it was left, links included.
  if (task && isBuiltinModInstalled("kanban", ctx.daemon.homeDir)) {
    try {
      const next = await ctx.issues.unlinkTask(task.repo, taskId)
      if (next) publishIssueSnapshot(ctx, next)
    } catch (err) {
      logDaemonError("issue-delete-unlink", err)
    }
  }
}

/**
 * `update --report-*` fields, or undefined when none were sent — never an
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

/** `task.create`'s `extraRepos`: `[{ repo, baseRef? }]` in pick order, or undefined when absent. */
function optionalExtraRepos(payload: Record<string, unknown>): { repo: string; baseRef?: string }[] | undefined {
  const raw = payload.extraRepos
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw)) throw new Error("extraRepos must be an array")
  return raw.map((entry, i) => {
    const item = objectPayload(entry)
    const repo = optionalString(item, "repo")
    if (!repo) throw new Error(`extraRepos[${i}].repo is required`)
    const baseRef = optionalString(item, "baseRef")
    return { repo, ...(baseRef ? { baseRef } : {}) }
  })
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
      // The CLI sends its $ROVE_TASK_ID/$ROVE_TAB_ID (the daemon has no caller
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
        extraRepos: optionalExtraRepos(payload),
        vendor: optionalVendor(payload, "vendor"),
        command: optionalString(payload, "command"),
        modelEffort: optionalString(payload, "effort"),
        model: optionalString(payload, "model"),
        tier: optionalString(payload, "tier"),
        groupId: optionalString(payload, "groupId"),
        dispatcher,
      })
      if (dispatcher) {
        // The first prompt rides the session launch, after this reply; the engine's first turn settles it.
        ctx.dispatches?.record({
          kind: "add",
          from: dispatcher,
          to: { taskId: task.id, tabId: "tab-1" },
          // `add` titles the task from its prompt; the prompt itself rides the launch, past the daemon.
          promptHead: task.title,
          delivered: true,
        })
      }
      return { taskId: task.id, task: serializeTask(task) }
    },
  },
  {
    // `git worktree add` on a big repo takes minutes: no client deadline.
    name: "task.spawn",
    blocking: true,
    async handle(payload, ctx) {
      const parentTaskId = requireString(payload, "parentTaskId")
      // The CLI sends its verified $ROVE_TASK_ID/$ROVE_TAB_ID; tab defaults to tab-1.
      const dispatcherTaskId = optionalString(payload, "dispatcherTaskId")
      const dispatcher = dispatcherTaskId
        ? { taskId: dispatcherTaskId, tabId: optionalString(payload, "dispatcherTabId") || "tab-1" }
        : undefined
      const result = await ctx.orch.spawnChildTask({
        parentTaskId,
        // A child gets its own worktree unless the caller says to share.
        worktree: optionalBoolean(payload, "worktree") ?? true,
        baseRef: optionalString(payload, "baseRef"),
        isolateIn: optionalString(payload, "isolateIn"),
        title: optionalString(payload, "title"),
        vendor: optionalVendor(payload, "vendor"),
        command: optionalString(payload, "command"),
        prompt: optionalString(payload, "prompt"),
        dispatcher,
      })
      return {
        taskId: result.task.id,
        task: serializeTask(result.task),
        parentDirty: result.parentDirty,
        sharedLinks: result.sharedLinks,
      }
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
      // The caller resolves the protocol: presets live in rove's state.json,
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
      const cascade = optionalBoolean(payload, "cascade")
      // Deepest first. Without `cascade` only the task itself goes and its
      // children are promoted by `prepareTaskDeletion`.
      const targets = cascade ? subtreeIds(ctx.orch.listTasks(), taskId) : [taskId]
      // Audit before `prepareTaskDeletion`, which can throw: refusals get
      // recorded too. Read the tasks now; the runner removes them from the index.
      const tasks = new Map(targets.map((id) => [id, ctx.orch.getTask(id)]))
      const byTaskId = optionalString(payload, "requestedByTaskId")
      for (const id of targets) {
        auditDeletionRequested(
          id,
          tasks.get(id),
          {
            clientId: ctx.clientId,
            ...(byTaskId
              ? { requestedBy: { taskId: byTaskId, tabId: optionalString(payload, "requestedByTabId") || "tab-1" } }
              : {}),
          },
          { force, deleteBranch },
        )
      }
      const accepted = await ctx.orch.prepareTaskDeletion(taskId, { force, deleteBranch, cascade })
      for (const id of targets) await releaseDeletedTask(ctx, id, tasks.get(id))
      // Per removed task, the PTYs its teardown must spare (a surviving child's conversation) or also take
      // (its own aliased one). Read now: the runner drops the rows from the index. Absent when nothing differs.
      const teardown = Object.fromEntries(
        targets.flatMap((id) => {
          const scope = teardownScope(ctx.orch.listTasks(), id, new Set(targets))
          return scope.spare.length > 0 || scope.also.length > 0 ? [[id, scope]] : []
        }),
      )
      if (accepted) for (const id of targets) ctx.deletions.enqueue(id)
      // Removal runs in the background (teardown can take tens of seconds), so
      // this reports only that the request was taken. `queued: false`: no such
      // task id, nothing will ever run.
      return {
        taskId,
        queued: accepted,
        ...(cascade ? { deleted: targets } : {}),
        ...(Object.keys(teardown).length > 0 ? { teardown } : {}),
      }
    },
  },
  {
    // Read-only git reads (HEAD, status, rev-list; worktree status only at
    // count zero), milliseconds. Not `blocking`, which would drop the client
    // deadline; the land confirm awaits it inline.
    name: "task.landPreflight",
    async handle(payload, ctx) {
      return {
        result: await ctx.orch.landPreflight(requireString(payload, "taskId"), optionalString(payload, "repo")),
      }
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
        repo: optionalString(payload, "repo"),
      })
      // A multi-repo run that stopped (conflict, refusal) throws, like a one-repo land does, so
      // every client fails loudly; the per-repo statuses ride along as the error's data.
      if (result.stopped) {
        const { code, message } = result.stopped
        throw Object.assign(new Error(message.startsWith(`${code}: `) ? message : `${code}: ${message}`), {
          name: "LandStoppedError",
          data: { stopped: result.stopped, repos: result.repos },
        })
      }
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
      if (!task) throw new Error(`task not found: ${taskId}`)
      const only = optionalString(payload, "repo")
      pickRepos(task, only)
      // Several repos: each against its own base, a conflict in one not stopping the rest.
      if (task.extraRepos?.length) return { result: await syncRepos(ctx.runtime, task, only) }
      if (!task.worktreePath) throw new Error("task has no worktree to sync")
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
    name: "task.archive",
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      if (typeof payload.archived !== "boolean") throw new Error("archived must be a boolean")
      const { archived } = payload
      // The task and every descendant move together: a hidden parent must not leave a visible orphan.
      const ids = subtreeIds(ctx.orch.listTasks(), taskId)
      if (archived && optionalBoolean(payload, "force") !== true) {
        const busy = ids.filter((id) => ENGINE_BUSY.has(ctx.activity.stateOf(id, null) ?? "idle"))
        if (busy.length > 0) {
          throw new Error(
            `TASK_BUSY: ${busy.length === 1 ? "an engine is" : `${busy.length} engines are`} still working or waiting on you in ${busy.join(", ")}; archive hides it without stopping it. Pass force to archive anyway.`,
          )
        }
      }
      for (const id of ids) await ctx.orch.setArchived(id, archived)
      return { archived: ids }
    },
  },
  {
    name: "task.requireReport",
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      if (typeof payload.required !== "boolean") throw new Error("required must be a boolean")
      await ctx.orch.setRequireReport(taskId, payload.required)
      return {}
    },
  },
  {
    name: "task.move",
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const direction = requireString(payload, "direction")
      if (direction === "top") await ctx.orch.moveTaskToTop(taskId)
      else if (direction === "up" || direction === "down") await ctx.orch.moveTask(taskId, direction === "up" ? -1 : 1)
      else throw new Error("direction must be up, down or top")
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
      if (status === "done" && prevStatus !== "done" && linked && isBuiltinModInstalled("kanban", ctx.daemon.homeDir)) {
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
        const path = await ctx.orch.ensureWorktree(taskId, {
          onProgress: (progress) =>
            ctx.bus.publish("task.jobs", { taskId, kind: "ensureWorktree", phase: "running", progress }),
        })
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
      // The bus caches the last value, so late-subscribing panes get the current focus.
      const taskId = optionalString(payload, "taskId") ?? null
      await ctx.orch.setActiveTask(taskId)
      ctx.bus.publish("active-task", { taskId })
      return {}
    },
  },
]
