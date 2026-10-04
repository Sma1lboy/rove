/** Durable attention-Inbox RPC handlers, plus the plugin row-token write. */

import { optionalBoolean, optionalNumber, optionalString, requireNumber, requireString } from "./handler-validators.ts"
import type { DaemonRequestHandler } from "./handlers.ts"
import { isRowTokenTone } from "./row-tokens.ts"

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
    name: "attention.list",
    handle(_payload, ctx) {
      return { items: ctx.inbox.snapshot() }
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
  {
    // Plugin-written row token: write/refresh one, or clear it. The token's
    // TTL is clamped store-side, so a caller cannot ask for "forever".
    name: "task.rowToken",
    handle(payload, ctx) {
      if (!ctx.rowTokens) return { ok: false, reason: "UNSUPPORTED" }
      const taskId = requireString(payload, "taskId")
      // `source` is the writing plugin's id, for attribution and quota. Not
      // authenticated — a plugin already runs arbitrary code as the user.
      const source = optionalString(payload, "source") ?? "cli"
      const key = optionalString(payload, "key") ?? "default"
      if (optionalBoolean(payload, "clear") === true) {
        return { ok: true, cleared: ctx.rowTokens.clear(taskId, source, optionalString(payload, "key")) }
      }
      const tone = payload.tone
      const token = ctx.rowTokens.set({
        taskId,
        source,
        key,
        text: requireString(payload, "text"),
        ...(isRowTokenTone(tone) ? { tone } : {}),
        ...(optionalNumber(payload, "ttlMs") !== undefined ? { ttlMs: optionalNumber(payload, "ttlMs") } : {}),
      })
      return { ok: true, token }
    },
  },
]
