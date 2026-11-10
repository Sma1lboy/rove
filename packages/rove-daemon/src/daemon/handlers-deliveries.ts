/** Delivery RPCs: arm → (CLI pastes) → settle, then the agent's report and the list read. */

import { logDaemonError } from "./crash-log.ts"
import { type Delivery, MAX_DELIVERIES_PER_TASK } from "./delivery-contracts.ts"
import { type DeliveryDeps, type DeliveryReportInput, reportDelivery } from "./delivery-ops.ts"
import { optionalNumber, optionalString, requireString } from "./handler-validators.ts"
import { awaitingMenu } from "./handlers-queue.ts"
import type { DaemonHandlerContext, DaemonRequestHandler } from "./handlers.ts"
import { ptyScopeFor } from "./pty-alias.ts"
import { displayTaskTitle } from "./serialize-task.ts"

/** The handler context's slice the delivery operations need. */
export function deliveryDepsOf(ctx: DaemonHandlerContext): DeliveryDeps {
  return {
    deliveries: ctx.deliveries,
    inbox: ctx.inbox,
    orch: ctx.orch,
    automations: ctx.automations,
    stopEngineTab: (taskId, tabId) =>
      ctx.runtime.stopTaskEngineTab(taskId, tabId, ptyScopeFor(ctx.orch.listTasks(), taskId)),
  }
}

function evidenceOf(payload: Record<string, unknown>): string[] | undefined {
  const raw = payload.evidence
  if (raw === undefined) return undefined
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string")) {
    throw new Error("evidence must be an array of strings")
  }
  return raw as string[]
}

export function reportInputOf(payload: Record<string, unknown>): DeliveryReportInput {
  const next = optionalString(payload, "next")
  const evidence = evidenceOf(payload)
  return {
    outcome: requireString(payload, "outcome") as DeliveryReportInput["outcome"],
    summary: requireString(payload, "summary"),
    ...(evidence ? { evidence } : {}),
    ...(next ? { next } : {}),
  }
}

/**
 * One line to the reported task's dispatcher tab, so the sender learns the
 * outcome without polling. Plain text: no footer, no provenance, nothing that
 * asks for a reply. Skipped when the tab is at a menu (Enter would pick an
 * option) or has no live engine; `deliveries` still has the report.
 */
// ponytail: addresses `task.dispatcher`, not the sender (deliveries do not store one), so a
// `send --expect-report` from a third session tells the child's dispatcher; store the sender on arm if that matters.
async function tellDispatcher(ctx: DaemonHandlerContext, delivery: Delivery): Promise<void> {
  if (delivery.source !== "send" || !delivery.report) return
  const worker = ctx.orch.getTask(delivery.taskId)
  const to = worker?.dispatcher
  if (!worker || !to || to.taskId === worker.id) return
  const seat = ctx.orch.getTask(to.taskId)
  if (!seat || seat.deletion || !seat.worktreePath) return
  if (ctx.activity.stateOf(to.taskId, to.tabId) === "permission_needed" || awaitingMenu(ctx, to.taskId, to.tabId))
    return
  const { outcome, summary } = delivery.report
  const line = summary.split("\n").find((l) => l.trim()) ?? summary
  const branch = worker.branch ? `, branch ${worker.branch}` : ""
  const text = `[ROVE REPORT] "${displayTaskTitle(worker)}" (task ${worker.id}${branch}) ${outcome}: ${line.length > 280 ? `${line.slice(0, 279)}…` : line}`
  await ctx.runtime
    .deliverPromptToLiveEngineTabDetailed(
      {
        id: seat.id,
        tabId: to.tabId,
        vendor: seat.vendor,
        command: seat.command,
        worktreePath: seat.worktreePath,
        scope: ptyScopeFor(ctx.orch.listTasks(), seat.id),
      },
      text,
    )
    .catch((err: unknown) => logDaemonError("delivery-report-notify", err))
}

export const DELIVERY_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    name: "delivery.arm",
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      if (!ctx.orch.getTask(taskId)) throw new Error(`task not found: ${taskId}`)
      const delivery = await ctx.deliveries.arm({
        taskId,
        tabId: optionalString(payload, "tabId") ?? null,
        source: "send",
        promptHead: requireString(payload, "promptHead"),
      })
      return { deliveryId: delivery.id }
    },
  },
  {
    name: "delivery.settle",
    async handle(payload, ctx) {
      const deliveryId = requireString(payload, "deliveryId")
      if (payload.delivered !== true) return { cancelled: await ctx.deliveries.cancel(deliveryId) }
      const tabId = optionalString(payload, "tabId")
      if (tabId) await ctx.deliveries.setTab(deliveryId, tabId)
      return { cancelled: false }
    },
  },
  {
    name: "delivery.report",
    async handle(payload, ctx) {
      const deliveryId = requireString(payload, "deliveryId")
      // An unknown id is `{delivery:null}` (the CLI names it); a malformed report throws.
      const delivery = await reportDelivery(deliveryDepsOf(ctx), deliveryId, reportInputOf(payload))
      if (delivery) await tellDispatcher(ctx, delivery)
      return { delivery }
    },
  },
  {
    name: "delivery.list",
    handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const limit = optionalNumber(payload, "limit")
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1))
        throw new Error("limit must be a positive integer")
      return {
        deliveries: ctx.deliveries.listForTask(
          taskId,
          Math.min(limit ?? MAX_DELIVERIES_PER_TASK, MAX_DELIVERIES_PER_TASK),
        ),
      }
    },
  },
]
