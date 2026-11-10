/** `task.addSessionPr`: attach a PR the task's session opened (`rove api pr-attach`). */

import { requireString } from "./handler-validators.ts"
import type { DaemonRequestHandler } from "./handlers.ts"
import { canonicalPrUrl } from "./session-prs.ts"

export const SESSION_PR_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    // Canonical url, so `/files` and `#comment` links of one PR dedupe.
    name: "task.addSessionPr",
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const rawUrl = requireString(payload, "url")
      const url = canonicalPrUrl(rawUrl)
      if (!url) throw new Error(`url must be a github.com/<owner>/<repo>/pull/<n> link: ${rawUrl}`)
      if (!ctx.orch.getTask(taskId)) throw new Error(`task not found: ${taskId}`)
      await ctx.orch.addSessionPr(taskId, url)
      return { taskId, url }
    },
  },
]
