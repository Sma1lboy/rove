/**
 * The two places decision gates meet delivery reports (feat/delivery-reports).
 * Kept apart so the join is one file: both are inert until that layer exists,
 * and gates behave fully without it.
 */

import type { DaemonTask } from "./contracts.ts"
import type { Gate } from "./gate-contracts.ts"
import type { DaemonHandlerContext } from "./handlers.ts"

/**
 * Raising a gate is the current delivery's report, outcome `blocked`: an agent
 * that asks and stops must not also be flagged `report_missing`.
 *
 * UNWIRED: needs `reportCurrentDelivery` from the deliveries layer.
 */
export async function countGateRaiseAsReport(_ctx: DaemonHandlerContext, _gate: Gate): Promise<void> {}

/**
 * Arm a delivery for a gate answer when the task requires reports; returns the
 * `[ROVE] When this turn ends, report: …` footer to paste after the answer.
 *
 * UNWIRED: needs `DeliveriesStore.arm` and `Task.requireReport`.
 */
export async function armGateAnswerDelivery(
  _ctx: DaemonHandlerContext,
  _task: DaemonTask,
  _gate: Gate,
): Promise<string | null> {
  return null
}
