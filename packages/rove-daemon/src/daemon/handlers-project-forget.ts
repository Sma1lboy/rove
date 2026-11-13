/** `project.forget`: drop a project from the list; its tasks and files stay. */

import { logDaemonError } from "./crash-log.ts"
import { requireString } from "./handler-validators.ts"
import type { DaemonRequestHandler } from "./handlers.ts"
import { teardownScope } from "./pty-alias.ts"

export const PROJECT_FORGET_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    name: "project.forget",
    async handle(payload, ctx) {
      const repo = requireString(payload, "repo")
      const before = ctx.orch.listTasks()
      await ctx.orch.forgetProject(repo)
      // The project's `main` row is gone: sessions left in it would run with no row to reach them.
      for (const task of before) {
        if (task.kind !== "main" || ctx.orch.getTask(task.id)) continue
        await ctx.runtime
          .tearDownTaskSession(task.id, teardownScope(before, task.id, new Set([task.id])))
          .catch((err) => logDaemonError("project-forget-session-teardown", err))
      }
      return {}
    },
  },
]
