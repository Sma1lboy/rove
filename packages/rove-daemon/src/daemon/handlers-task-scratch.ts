/** Directory tasks: open one (`rove .`, Scratch, a session in a project's own checkout) or adopt a scratch one into the repo its shell landed in. */

import { optionalBoolean, optionalString, optionalVendor, requireString } from "./handler-validators.ts"
import type { DaemonRequestHandler } from "./handlers.ts"
import { serializeTask } from "./serialize-task.ts"

export const SCRATCH_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    name: "task.openDir",
    async handle(payload, ctx) {
      const dir = requireString(payload, "dir")
      const task = await ctx.orch.openDirectoryTask({
        dir,
        vendor: optionalVendor(payload, "vendor"),
        scratch: optionalBoolean(payload, "scratch"),
        title: optionalString(payload, "title"),
        model: optionalString(payload, "model"),
        modelEffort: optionalString(payload, "effort"),
        // The link directory of a workspace on another machine (`add --workspace-on`).
        ...(optionalBoolean(payload, "remote") ? { workspace: { backend: "remote" as const } } : {}),
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
]
