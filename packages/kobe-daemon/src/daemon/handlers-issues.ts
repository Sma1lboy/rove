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
      // A `link` op — and an `update` carrying a `taskId` — names a task, and
      // the store only type-checks `taskId` as a non-empty string; without
      // this guard a typo'd id is accepted and the card sits in In progress
      // pointing at nothing. The check lives HERE, rather than in the store:
      // both the
      // CLI (`issue-update --task`) and the web link route funnel through this
      // one RPC, and the task index is on the handler context, so the issue
      // store keeps knowing nothing about tasks. The prose is the same one
      // every other handler throws, which `toApiError` maps to a typed
      // TASK_NOT_FOUND with the `api list` recovery command.
      //
      // It also runs BEFORE `issues.mutate` takes the store lock, which is
      // what makes the CLI's title+link update all-or-nothing: a bad link
      // rejects the whole op instead of landing the rename first.
      const op = payload.op
      const opType = op && typeof op === "object" ? (op as { type?: unknown }).type : undefined
      if (opType === "link" || opType === "update") {
        const taskId = (op as { taskId?: unknown }).taskId
        if (typeof taskId === "string" && taskId.length > 0 && !ctx.orch.getTask(taskId)) {
          throw new Error(`task not found: ${taskId}`)
        }
      }
      const state = await ctx.issues.mutate(repoRoot, payload.op)
      // Write-only in this repo; kept as a plugin API — see `channels.ts`.
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
