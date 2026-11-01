/** Directory tasks with no project: open one (`rove .`, Scratch), and move an ungrouped one into a project. */

import { optionalBoolean, optionalVendor, requireString } from "./handler-validators.ts"
import type { DaemonRequestHandler } from "./handlers.ts"
import { serializeTask } from "./protocol.ts"

export const SCRATCH_HANDLERS: readonly DaemonRequestHandler[] = [
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
    // `update --project`: the session's directory stays, so its engine resumes where it was.
    name: "task.moveToProject",
    blocking: true,
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const repo = requireString(payload, "repo")
      const task = ctx.orch.getTask(taskId)
      if (!task) throw new Error(`task not found: ${taskId}`)
      if (task.kind !== "dir" || task.scratch !== true) {
        throw new Error(
          `NOT_UNGROUPED: task ${taskId} already belongs to ${task.repo}; only an Ungrouped session moves`,
        )
      }
      // The project's main row first, so the moved task lands under a real project header.
      const main = await ctx.orch.ensureMainTask(repo)
      await ctx.orch.adoptScratchRepo(taskId, main.repo, { keepDirectory: true })
      return { taskId, repo: main.repo }
    },
  },
]
