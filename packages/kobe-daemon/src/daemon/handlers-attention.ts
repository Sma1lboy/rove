/** Durable attention-Inbox RPC handlers. */

import { optionalString, requireNumber, requireString } from "./handler-validators.ts"
import type { DaemonRequestHandler } from "./handlers.ts"

export const ATTENTION_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    // A routine episode is keyed on its SCHEDULE, not a task, so it cannot be
    // addressed by `attention.dismiss` — which takes a taskId a broken routine
    // may never have produced.
    name: "attention.dismissRoutine",
    async handle(payload, ctx) {
      await ctx.inbox.deleteRoutineEpisode(requireString(payload, "automationId"))
      return { deleted: true }
    },
  },
  {
    name: "attention.dismiss",
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const tabId = optionalString(payload, "tabId") ?? null
      const at = payload.at === undefined ? undefined : requireNumber(payload, "at")
      const deleted = await ctx.inbox.deleteEpisode(taskId, tabId, at)
      if (deleted) {
        ctx.plugins?.handleUiReport({
          kind: "attention.handled",
          taskId,
          detail: { how: "dismissed", ...(tabId ? { tabId } : {}) },
        })
      }
      return { deleted }
    },
  },
  {
    name: "attention.read",
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const tabId = optionalString(payload, "tabId") ?? null
      const at = requireNumber(payload, "at")
      const updated = await ctx.inbox.markRead(taskId, tabId, at)
      if (updated) {
        ctx.plugins?.handleUiReport({
          kind: "attention.handled",
          taskId,
          detail: { how: "read", ...(tabId ? { tabId } : {}) },
        })
      }
      return { updated }
    },
  },
]
