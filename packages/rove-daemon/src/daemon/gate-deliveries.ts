/**
 * The two places decision gates meet delivery reports. Kept apart so the join
 * is one file.
 */

import type { DaemonTask } from "./contracts.ts"
import { type Delivery, deliveryFooter } from "./delivery-contracts.ts"
import { reportCurrentDelivery } from "./delivery-ops.ts"
import type { Gate } from "./gate-contracts.ts"
import { deliveryDepsOf } from "./handlers-deliveries.ts"
import type { DaemonHandlerContext } from "./handlers.ts"

/**
 * Raising a gate is the current delivery's report, outcome `blocked`: an agent
 * that asks and stops must not also be flagged `report_missing`. Returns the
 * delivery it settled; null when nothing was armed (an ordinary chat turn owes
 * no report).
 */
export async function countGateRaiseAsReport(ctx: DaemonHandlerContext, gate: Gate): Promise<Delivery | null> {
  return await reportCurrentDelivery(deliveryDepsOf(ctx), gate.taskId, gate.tabId, {
    outcome: "blocked",
    summary: gate.question,
    next: `awaiting owner decision ${gate.id}`,
  })
}

export interface GateAnswerDelivery {
  readonly deliveryId: string
  /** The `[ROVE] When this turn ends, report: …` line to paste after the answer. */
  readonly footer: string
}

/**
 * A gate answer is the next tick of the task: when the task requires reports,
 * arm a delivery for it before the paste (a failed turn can fire its hook
 * within milliseconds). Null when the task does not require reports.
 */
export async function armGateAnswerDelivery(
  ctx: DaemonHandlerContext,
  task: DaemonTask,
  gate: Gate,
): Promise<GateAnswerDelivery | null> {
  if (task.requireReport !== true) return null
  const delivery = await ctx.deliveries.arm({
    taskId: task.id,
    tabId: gate.tabId,
    source: "gate-answer",
    gateId: gate.id,
    promptHead: gate.question,
  })
  return { deliveryId: delivery.id, footer: deliveryFooter(delivery.id, ctx.runtime.roveApiInvocation()) }
}
