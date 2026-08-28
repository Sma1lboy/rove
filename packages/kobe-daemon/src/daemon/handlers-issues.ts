/** Daemon-owned issue store RPCs (`docs/WORK-TRACKING.md`). A mutation
 *  republishes the repo's whole snapshot, so every attached surface renders
 *  from one truth instead of patching its own copy. */

import { requireString } from "./handler-validators.ts"
import type { DaemonRequestHandler } from "./handlers.ts"

export const ISSUE_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    name: "issue.list",
    async handle(payload, ctx) {
      return ctx.issues.list(requireString(payload, "repoRoot"))
    },
  },
  {
    name: "issue.mutate",
    async handle(payload, ctx) {
      const repoRoot = requireString(payload, "repoRoot")
      const state = await ctx.issues.mutate(repoRoot, payload.op)
      ctx.bus.publish("issue.snapshot", state)
      ctx.plugins?.handleUiReport({
        kind: "issue.changed",
        detail: {
          repo: repoRoot,
          ...(payload.op && typeof payload.op === "object" ? { op: payload.op as Record<string, unknown> } : {}),
        },
      })
      return state
    },
  },
]
