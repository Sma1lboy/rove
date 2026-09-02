/** Durable attention-Inbox RPC handlers. */

import type { DeferredPromptDiscardReason } from "./deferred-prompts-store.ts"
import { optionalString, requireNumber, requireString } from "./handler-validators.ts"
import type { DaemonHandlerContext, DaemonRequestHandler } from "./handlers.ts"

async function discardMatchingDeferredPrompt(
  ctx: DaemonHandlerContext,
  taskId: string,
  tabId: string | null,
  at: number | undefined,
  reason: DeferredPromptDiscardReason,
): Promise<void> {
  if (!tabId || !ctx.deferredPrompts) return
  const matches = ctx.inbox
    .snapshot()
    .some(
      (item) =>
        item.taskId === taskId &&
        item.tabId === tabId &&
        item.state === "prompt_deferred" &&
        (at === undefined || item.at === at),
    )
  if (matches) await ctx.deferredPrompts.discardTab(taskId, tabId, reason)
}

export const ATTENTION_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    name: "attention.dismiss",
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const tabId = optionalString(payload, "tabId") ?? null
      const at = payload.at === undefined ? undefined : requireNumber(payload, "at")
      await discardMatchingDeferredPrompt(ctx, taskId, tabId, at, "Inbox item dismissed")
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
      await discardMatchingDeferredPrompt(ctx, taskId, tabId, at, "Inbox item read by legacy client")
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
