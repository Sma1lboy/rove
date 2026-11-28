/** Directory tasks: open one (`rove .`, a No folder session, a session in a project's own checkout). */

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
        // `scratch` is what clients one version behind send for a No folder session.
        noProject: optionalBoolean(payload, "noProject") || optionalBoolean(payload, "scratch"),
        title: optionalString(payload, "title"),
        model: optionalString(payload, "model"),
        modelEffort: optionalString(payload, "effort"),
        // The link directory of a workspace on another machine (`add --workspace-on`).
        ...(optionalBoolean(payload, "remote") ? { workspace: { backend: "remote" as const } } : {}),
      })
      return { taskId: task.id, task: serializeTask(task) }
    },
  },
]
