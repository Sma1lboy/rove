/** `project.forget`: drop a project from the list; its tasks and files stay. */

import { requireString } from "./handler-validators.ts"
import type { DaemonRequestHandler } from "./handlers.ts"

export const PROJECT_FORGET_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    name: "project.forget",
    async handle(payload, ctx) {
      await ctx.orch.forgetProject(requireString(payload, "repo"))
      return {}
    },
  },
]
