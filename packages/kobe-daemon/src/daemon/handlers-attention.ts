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
): Promise<string | undefined> {
  if (!tabId || !ctx.deferredPrompts) return undefined
  const deferredId = ctx.inbox
    .snapshot()
    .find(
      (item) =>
        item.taskId === taskId &&
        item.tabId === tabId &&
        item.state === "prompt_deferred" &&
        (at === undefined || item.at === at),
    )?.detail?.deferredPrompt?.id
  if (deferredId) await ctx.deferredPrompts.discard(deferredId, reason)
  return deferredId
}

export const ATTENTION_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    name: "attention.dismiss",
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const tabId = optionalString(payload, "tabId") ?? null
      const at = payload.at === undefined ? undefined : requireNumber(payload, "at")
      const deferredId = await discardMatchingDeferredPrompt(ctx, taskId, tabId, at, "Inbox item dismissed")
      const deleted = await ctx.inbox.deleteEpisode(
        taskId,
        tabId,
        at,
        deferredId ? "prompt_deferred" : undefined,
        deferredId,
      )
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
      const deferredId = await discardMatchingDeferredPrompt(ctx, taskId, tabId, at, "Inbox item read by legacy client")
      const updated = await ctx.inbox.markRead(
        taskId,
        tabId,
        at,
        deferredId ? "prompt_deferred" : undefined,
        deferredId,
      )
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
