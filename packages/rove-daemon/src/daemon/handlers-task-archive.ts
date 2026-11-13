/**
 * `task.archive`: hide or restore a task and its descendants, Inbox rows included. Archiving
 * ends their sessions (a hidden row must not keep processes alive); the worktree, branch and
 * each tab's conversation stay. The guards are a busy engine and a project's `main`.
 */

import { logDaemonError } from "./crash-log.ts"
import { teardownScope } from "./pty-alias.ts"

import { subtreeIds } from "../task-tree.ts"
import { optionalBoolean, requireString } from "./handler-validators.ts"
import type { DaemonRequestHandler } from "./handlers.ts"

/** Engine states that mean someone is mid-work: archiving would stop it and hide a row that still needs eyes. */
const ENGINE_BUSY: Readonly<Record<string, true>> = { running: true, permission_needed: true }

export const ARCHIVE_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    name: "task.archive",
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      if (typeof payload.archived !== "boolean") throw new Error("archived must be a boolean")
      const { archived } = payload
      const task = ctx.orch.getTask(taskId)
      if (!task) throw new Error(`task not found: ${taskId}`)
      // A project's main checkout is the project row itself; hiding it would hide the project.
      if (task.kind === "main") throw new Error("MAIN_TASK: a project's main checkout cannot be archived")
      // The task and every descendant move together: a hidden parent must not leave a visible orphan.
      const ids = subtreeIds(ctx.orch.listTasks(), taskId)
      if (archived && optionalBoolean(payload, "force") !== true) {
        const busy = ids.filter((id) => ENGINE_BUSY[ctx.activity.stateOf(id, null) ?? "idle"] === true)
        if (busy.length > 0) {
          throw new Error(
            `TASK_BUSY: ${busy.length === 1 ? "an engine is" : `${busy.length} engines are`} still working or waiting on you in ${busy.join(", ")}; archive would stop it. Pass force to archive anyway.`,
          )
        }
      }
      for (const id of ids) await ctx.orch.setArchived(id, archived)
      if (archived) {
        const tasks = ctx.orch.listTasks()
        const leaving = new Set(ids)
        for (const id of ids) {
          await ctx.runtime
            .tearDownTaskSession(id, teardownScope(tasks, id, leaving))
            .catch((err) => logDaemonError("task-archive-session-teardown", err))
        }
      }
      // The Inbox leaves out archived tasks' rows.
      ctx.inbox.publish()
      return { archived: ids }
    },
  },
]
