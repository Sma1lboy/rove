/** Delivery RPCs: arm → (CLI pastes) → settle, then the agent's report and the list read. */

import { MAX_DELIVERIES_PER_TASK } from "./delivery-contracts.ts"
import { type DeliveryDeps, type DeliveryReportInput, reportDelivery } from "./delivery-ops.ts"
import { optionalNumber, optionalString, requireString } from "./handler-validators.ts"
import type { DaemonHandlerContext, DaemonRequestHandler } from "./handlers.ts"

/** The handler context's slice the delivery operations need. */
export function deliveryDepsOf(ctx: DaemonHandlerContext): DeliveryDeps {
  return { deliveries: ctx.deliveries, inbox: ctx.inbox, orch: ctx.orch, automations: ctx.automations }
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
