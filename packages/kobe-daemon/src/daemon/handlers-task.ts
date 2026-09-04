/**
 * `task.*` (+ `project.forget`) daemon RPC handlers — the `task.` slice of the
 * one registry, spread back into it by `handlers.ts`.
 *
 * The cut follows the RPC name prefix and nothing deeper: which file a handler
 * lives in is decided by its wire name, so this is a long registry grouped by
 * namespace rather than a responsibility boundary. Adding a `task.*` handler
 * here and a `ui.*` one in `handlers-ui.ts` are the same edit.
 *
 * What the split does NOT relax: see `handlers.ts`'s doc comment for the
 * registry's wire-compatibility contract (byte-equivalent payloads, key order
 * load-bearing). Moving a handler between files must never change either.
 */

import { logDaemonError } from "./crash-log.ts"
import { optionalBoolean, optionalString, optionalVendor, requireString } from "./handler-validators.ts"
import type { DaemonHandlerContext, DaemonRequestHandler } from "./handlers.ts"
import { serializeTask } from "./protocol.ts"
import { auditDeletionRequested } from "./task-deletion-audit.ts"

export const TASK_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    name: "task.list",
    web: true,
    handle(_payload, ctx: DaemonHandlerContext) {
      // `activeTaskId` is the shared focus every verb using the implicit
      // target reads when `--task-id` is omitted — without it in the list
      // envelope, a misdirected delivery is unauditable. The signal is the
      // same source server.ts seeds the active-task channel from; test
      // doubles may not stub it, so absence reads as "no focus".
      return {
        tasks: ctx.orch.listTasks().map(serializeTask),
        activeTaskId: ctx.orch.activeTaskSignal?.()?.() ?? null,
      }
    },
  },
  {
    name: "task.get",
    web: true,
    handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const task = ctx.orch.getTask(taskId)
      if (!task) throw new Error(`task not found: ${taskId}`)
      return { task: serializeTask(task) }
    },
  },
  {
    name: "task.create",
    web: true,
    async handle(payload, ctx) {
      const repo = requireString(payload, "repo")
      // Dispatcher provenance: the CLI reads its own
      // $KOBE_TASK_ID/$KOBE_TAB_ID and sends both flat — the daemon process
      // has no caller env of its own. Recorded only when the task id is
      // present; the tab floor is tab-1, the canonical first engine tab.
      const dispatcherTaskId = optionalString(payload, "dispatcherTaskId")
      const dispatcher = dispatcherTaskId
        ? { taskId: dispatcherTaskId, tabId: optionalString(payload, "dispatcherTabId") || "tab-1" }
        : undefined
      const task = await ctx.orch.createTask({
        repo,
        title: optionalString(payload, "title"),
        branch: optionalString(payload, "branch"),
        baseRef: optionalString(payload, "baseRef"),
        vendor: optionalVendor(payload, "vendor"),
        command: optionalString(payload, "command"),
        modelEffort: optionalString(payload, "effort"),
        groupId: optionalString(payload, "groupId"),
        dispatcher,
      })
      return { taskId: task.id, task: serializeTask(task) }
    },
  },
  {
    name: "task.rename",
    web: true,
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      await ctx.orch.setTitle(taskId, requireString(payload, "title"))
      return {}
    },
  },
  {
    name: "task.setBranch",
    web: true,
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      await ctx.orch.setBranch(taskId, requireString(payload, "branch"))
      return {}
    },
  },
  {
    name: "task.observeLanguage",
    // NOT web-exposed: the only callers are Rove's own creation paths (CLI
    // add, daemon automation/work-item start), which reach the daemon over
    // the socket. The browser has no reason to write another task's
    // observed language, and the web allowlist is a security contract —
    // adding to it should be a deliberate act, not a reflex.
    async handle(payload, ctx) {
      // Observation, not configuration: the caller hands over the user's own
      // prompt text and the orchestrator decides what (if anything) it says
      // about their language. Text with no opinion in it writes nothing, so
      // a bare "ok" cannot erase what a paragraph established.
      const taskId = requireString(payload, "taskId")
      const text = requireString(payload, "text")
      await ctx.orch.observeLanguage(taskId, text)
      return {}
    },
  },
  {
    name: "task.setVendor",
    web: true,
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const vendor = optionalVendor(payload, "vendor")
      if (!vendor) throw new Error("task.setVendor: vendor is required")
      // Not `optionalString`: that maps `""` to undefined, and `""` is the
      // wire spelling of "clear the level". Absent stays absent.
      const rawEffort = payload.effort
      if (rawEffort !== undefined && typeof rawEffort !== "string") throw new Error("effort must be a string")
      await ctx.orch.setVendor(taskId, vendor, rawEffort)
      return {}
    },
  },
  {
    name: "task.setCommand",
    web: true,
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      // The PROTOCOL rides along rather than being derived here: engine
      // presets live in kobe's state.json (`customEngineIds` /
      // `engineProtocol.<id>`), which this process deliberately cannot read.
      // Absent = the caller had no verdict; the task keeps its current one.
      await ctx.orch.setCommand(taskId, requireString(payload, "command"), optionalVendor(payload, "vendor"))
      return {}
    },
  },
  {
    name: "task.delete",
    web: true,
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const force = optionalBoolean(payload, "force")
      const deleteBranch = optionalBoolean(payload, "deleteBranch")
      // Audit BEFORE the accept: `prepareTaskDeletion` can throw
      // (DirtyWorktreeError), and a refused destructive request is exactly as
      // worth recording as an accepted one. Read the task here too — by the
      // time the background runner finishes, it is gone from the index.
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
      // A hard task delete is an explicit user deletion, so it is the one
      // lifecycle action allowed to cascade its durable Inbox episodes.
      await ctx.inbox.deleteTaskBestEffort(taskId)
      // Drop the issue link too, for the same reason: the issue owns the link
      // (`Issue.taskId`), so nothing else would ever clear it, and a card whose
      // task is gone would render In progress forever. Best-effort like the
      // done-mirror above — the deletion already committed, so a missing repo
      // or a raced issue write is logged, never surfaced as a failed delete.
      if (task) {
        try {
          const next = await ctx.issues.unlinkTask(task.repo, taskId)
          if (next) ctx.bus.publish("issue.snapshot", next)
        } catch (err) {
          logDaemonError("issue-delete-unlink", err)
        }
      }
      if (accepted) ctx.deletions.enqueue(taskId)
      // `accepted` is the whole point of the reply. Removal itself runs in the
      // background (a worktree teardown can take tens of seconds), so this can
      // only ever report that the request was TAKEN, never that it finished.
      // A bare `{}` would make a refusal indistinguishable from a success:
      // `queued: false` means nothing was scheduled, because the task id does
      // not exist and no deletion will ever run for it.
      return { taskId, queued: accepted }
    },
  },
  {
    // Read-only sibling of `task.land`: four git reads (HEAD, status,
    // rev-list, and the worktree's status only when the count is zero), no
    // writes. Deliberately NOT `blocking` — putting it on the long-operation
    // list would tell the client to drop its deadline for something that
    // finishes in milliseconds, and the land confirm awaits it inline.
    name: "task.landPreflight",
    web: true,
    async handle(payload, ctx) {
      return { result: await ctx.orch.landPreflight(requireString(payload, "taskId")) }
    },
  },
  {
    name: "task.land",
    blocking: true,
    web: true,
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const strategy = optionalString(payload, "strategy") === "squash" ? "squash" : "merge"
      const result = await ctx.orch.landTask(taskId, {
        strategy,
        deleteBranch: optionalBoolean(payload, "deleteBranch") === true,
        // Passed through as undefined when absent so the orchestrator's
        // default (remove the landed worktree) applies; only an explicit
        // `false` from the caller keeps it.
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
      // Throws `SYNC_CONFLICT: <files>` / `SYNC_WORKTREE_DIRTY` for the two
      // outcomes a human acts on — the caller matches the marker, exactly the
      // way it already does for `LAND_CONFLICT`.
      return { result: await ctx.runtime.syncWorktreeWithBase(task.worktreePath, task.baseRef) }
    },
  },
  {
    name: "task.pin",
    web: true,
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      await ctx.orch.setPinned(taskId, optionalBoolean(payload, "pinned"))
      return {}
    },
  },
  {
    name: "task.move",
    web: true,
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
    web: true,
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const status = requireString(payload, "status")
      if (!ctx.runtime.isTaskStatus(status)) throw new Error("status must be a TaskStatus")
      // Capture the task (for repo) AND its prior status BEFORE the
      // transition so we can mirror a real task→done transition into the
      // issue store below.
      const linked = status === "done" ? ctx.orch.getTask(taskId) : undefined
      const prevStatus = linked?.status
      await ctx.orch.setStatus(taskId, status)
      // Done-mirroring: a task reaching `done` flips its source issue to
      // `done` too, so a unified board stays consistent. The reverse-look-up
      // (issue owns the link via `Issue.taskId`) and the conditional flip run
      // atomically inside the issue store under one lock — so a concurrent
      // reopen from another surface can't be clobbered by a stale read.
      // Guarded to an ACTUAL →done transition (prevStatus !== "done", so
      // re-firing done on an already-done task never re-clobbers a
      // manually-reopened issue); the issue write must never fail the task
      // update (the status change already committed), so a missing/raced
      // issue is logged + swallowed.
      if (status === "done" && prevStatus !== "done" && linked) {
        try {
          const next = await ctx.issues.mirrorTaskDone(linked.repo, taskId)
          if (next) ctx.bus.publish("issue.snapshot", next)
        } catch (err) {
          logDaemonError("issue-done-mirror", err)
        }
      }
      return {}
    },
  },
  {
    name: "task.openDir",
    web: true,
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
    // Scratch → project migration: repoint a scratch task at the
    // repo its shell settled in and clear the flag. No-op on non-scratch rows.
    name: "task.adoptScratchRepo",
    web: true,
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      await ctx.orch.adoptScratchRepo(taskId, requireString(payload, "repo"))
      return {}
    },
  },
  {
    name: "task.ensureMain",
    blocking: true,
    web: true,
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
    web: true,
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      // Long-operation feedback: `git worktree add` is
      // minute-class on a huge repo, and the RPC stays BLOCKING (callers
      // need the path before the engine session can start) — so publish lifecycle
      // progress on the `task.jobs` channel around the call. Every
      // attached Tasks pane shows a "materializing" row state, not just
      // the initiating client. A terminal phase (`done`/`error`) is
      // published ALWAYS, including on throw — otherwise the bus's
      // last-value replay would show late subscribers a stuck `running`
      // forever. Fast paths (already-materialised worktree, `main`
      // tasks) publish running→done back-to-back, which clients fold
      // into a no-op blink at worst. The error message rides along for
      // UI hints; the RPC error itself still reaches the caller via the
      // rethrow.
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
    // NOT web-exposed. Two writers, both on a path where the prompt is already
    // on its way to an engine: the CLI `add` path records the brief AFTER
    // delivery confirms, and the TUI's "Run again" copies a task's existing
    // brief onto the fork it just created for it. The field means "this is the
    // prompt the engine was given" in both cases — an agent reading `get-task`
    // never sees a brief that was merely composed.
    name: "task.setPrompt",
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      await ctx.orch.setPrompt(taskId, requireString(payload, "prompt"))
      return {}
    },
  },
  {
    name: "task.setActive",
    web: true,
    async handle(payload, ctx) {
      // UI/session focus lives on the bus, but setting it also touches the
      // task's updatedAt so "recent" task sorting reflects actual use.
      // Publishing caches the last value so a late-subscribing Tasks pane
      // gets the current focus on connect and every pane highlights the
      // same active task.
      const taskId = optionalString(payload, "taskId") ?? null
      await ctx.orch.setActiveTask(taskId)
      ctx.bus.publish("active-task", { taskId })
      return {}
    },
  },
]
