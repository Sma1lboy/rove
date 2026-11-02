/**
 * `queue.add` / `queue.list` / `queue.cancel` over {@link PromptQueue}, and the hand-over itself: the
 * daemon pastes a held prompt into its tab the way it pastes an answered gate, arming a report only then
 * (a delivery armed at enqueue time would be settled by the turn already running).
 */

import { logDaemonError } from "./crash-log.ts"
import { deliveryFooter } from "./delivery-contracts.ts"
import { optionalBoolean, optionalString, requireString } from "./handler-validators.ts"
import type { DaemonHandlerContext, DaemonRequestHandler } from "./handlers.ts"
import type { PromptQueue, QueuedPrompt } from "./prompt-queue.ts"
import { ptyScopeFor } from "./pty-alias.ts"

function queueOf(ctx: DaemonHandlerContext): PromptQueue {
  if (!ctx.promptQueue) throw new Error("this daemon has no prompt queue")
  return ctx.promptQueue
}

/**
 * A paste into this tab could land in a menu: the row status every client shows says it needs input, or the
 * tab came to rest straight from a menu (a stray Stop; the menu may still be drawn) and no client has since
 * answered it with keys. Enter into a menu would confirm its highlighted option.
 */
export function awaitingMenu(
  ctx: Pick<DaemonHandlerContext, "rowStatus" | "promptQueue">,
  taskId: string,
  tabId: string,
): boolean {
  if (ctx.rowStatus?.list().tasks[taskId]?.tabs[tabId]?.kind === "needs-input") return true
  return ctx.promptQueue?.restUnconfirmed(taskId, tabId, ctx.rowStatus?.answeredAt(taskId, tabId)) === true
}

/** Why the tab cannot take a queued paste right now, read at paste time. Null when it can. */
export function heldBack(
  ctx: Pick<DaemonHandlerContext, "activity" | "rowStatus" | "promptQueue">,
  item: QueuedPrompt,
): string | null {
  const state = ctx.activity.stateOf(item.taskId, item.tabId)
  if (state === "permission_needed" || awaitingMenu(ctx, item.taskId, item.tabId)) return "awaiting-permission"
  if (state === "running" || state === "rate_limited") return "busy"
  return null
}

/** Paste one held prompt; null when it landed, else why not. */
export async function pasteQueued(ctx: DaemonHandlerContext, item: QueuedPrompt): Promise<string | null> {
  const task = ctx.orch.getTask(item.taskId)
  if (!task || task.deletion || !task.worktreePath) return "task is gone"
  const blocked = heldBack(ctx, item)
  if (blocked) return blocked
  let deliveryId: string | null = null
  try {
    if (item.expectReport || task.requireReport === true) {
      const delivery = await ctx.deliveries.arm({
        taskId: task.id,
        tabId: item.tabId,
        source: "send",
        promptHead: item.text,
      })
      deliveryId = delivery.id
    }
    const text = deliveryId
      ? `${item.text}\n\n${deliveryFooter(deliveryId, ctx.runtime.roveApiInvocation())}`
      : item.text
    const result = await ctx.runtime.deliverPromptToLiveEngineTabDetailed(
      {
        id: task.id,
        vendor: task.vendor,
        command: task.command,
        worktreePath: task.worktreePath,
        scope: ptyScopeFor(ctx.orch.listTasks(), task.id),
        tabId: item.tabId,
      },
      text,
    )
    if (result.outcome !== "delivered") {
      if (deliveryId) await ctx.deliveries.cancel(deliveryId)
      return result.outcome
    }
    if (deliveryId) await ctx.deliveries.setTab(deliveryId, result.tabId)
    return null
  } catch (err) {
    logDaemonError("queue-handover", err)
    if (deliveryId) await ctx.deliveries.cancel(deliveryId).catch(() => {})
    return err instanceof Error ? err.message : String(err)
  }
}

export const QUEUE_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    name: "queue.add",
    handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const task = ctx.orch.getTask(taskId)
      if (!task || task.deletion) throw new Error(`task not found: ${taskId}`)
      return queueOf(ctx).add({
        taskId,
        tabId: requireString(payload, "tabId"),
        text: requireString(payload, "text"),
        expectReport: optionalBoolean(payload, "expectReport") === true,
      })
    },
  },
  {
    name: "queue.list",
    handle(payload, ctx) {
      const queue = queueOf(ctx)
      // A deleted task takes its held prompts with it; nothing could ever paste them.
      for (const item of queue.list()) if (!ctx.orch.getTask(item.taskId)) queue.cancel(item.id)
      return { items: queue.list(optionalString(payload, "taskId")) }
    },
  },
  {
    name: "queue.cancel",
    handle(payload, ctx) {
      return { cancelled: queueOf(ctx).cancel(requireString(payload, "id")) }
    },
  },
  {
    // A plain `send` pastes at once, even into a running turn (`--queue` is the after-this-turn lane); it
    // only refuses a tab at a menu. `settleMs` is how long a menu event trailing a fresh turn end may still land.
    name: "send.check",
    handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const named = optionalString(payload, "tabId")
      const tabs = named
        ? [named]
        : [
            ...new Set([
              ...Object.keys(ctx.rowStatus?.list().tasks[taskId]?.tabs ?? {}),
              ...(ctx.promptQueue?.tabsOf(taskId) ?? []),
            ]),
          ]
      return {
        awaiting: tabs.filter((tab) => awaitingMenu(ctx, taskId, tab)),
        settleMs: Math.max(0, ...tabs.map((tab) => ctx.promptQueue?.settleLeft(taskId, tab) ?? 0)),
      }
    },
  },
]
