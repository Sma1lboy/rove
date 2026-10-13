/** Should-run RPCs: the read verdict, and the admit/release pair `send --if-runnable` brackets its paste with. */

import { optionalBoolean, optionalString, requireString } from "./handler-validators.ts"
import type { DaemonHandlerContext, DaemonRequestHandler } from "./handlers.ts"
import type { RunnabilityVerdict, SkipReason } from "./runnability-contracts.ts"
import { type RunnabilityDeps, evaluateRunnability } from "./runnability.ts"

/** The handler context's slice the evaluator reads. */
export function runnabilityDepsOf(ctx: DaemonHandlerContext): RunnabilityDeps {
  return { orch: ctx.orch, activity: ctx.activity, gates: ctx.gates, deliveries: ctx.deliveries }
}

/**
 * A canonical or new-tab send respawns a dead engine itself, so `engine-dead`
 * only blocks an exact tab that was not asked to be respawned.
 */
function ignoredFor(tabId: string | undefined, respawn: boolean | undefined): readonly SkipReason[] {
  return tabId && tabId !== "new" && !respawn ? [] : ["engine-dead"]
}

export const RUNNABILITY_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    name: "task.runnability",
    handle(payload, ctx): RunnabilityVerdict {
      const tabId = optionalString(payload, "tabId")
      return evaluateRunnability(runnabilityDepsOf(ctx), requireString(payload, "taskId"), tabId ?? null, {
        ignore: ignoredFor(tabId, optionalBoolean(payload, "respawn")),
      })
    },
  },
  {
    // Evaluate, claim and (when the send owes a report) arm without an await between the
    // verdict and the claim, so two concurrent ticks cannot both be admitted. The paste itself
    // happens in the CLI; the claim keeps the tab `busy` until `send.release` or its expiry.
    name: "send.admit",
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const tabId = optionalString(payload, "tabId")
      const promptHead = requireString(payload, "promptHead")
      const verdict = evaluateRunnability(runnabilityDepsOf(ctx), taskId, tabId ?? null, {
        ignore: ignoredFor(tabId, optionalBoolean(payload, "respawn")),
      })
      const armed =
        optionalBoolean(payload, "expectReport") === true || ctx.orch.getTask(taskId)?.requireReport === true
      const pinnedTab = tabId && tabId !== "new" ? tabId : null
      if (!verdict.run) {
        // Only a send that would have owed a report leaves a delivery row.
        const skipped = armed
          ? await ctx.deliveries.recordSkipped({
              taskId,
              tabId: pinnedTab,
              source: "send",
              promptHead,
              skipped: verdict,
            })
          : undefined
        return { skipped: verdict, ...(skipped ? { deliveryId: skipped.id } : {}) }
      }
      const claimId = ctx.deliveries.claims.claim(taskId, pinnedTab, armed)
      if (!armed) return { claimId }
      try {
        const delivery = await ctx.deliveries.arm({ taskId, tabId: pinnedTab, source: "send", promptHead })
        return { claimId, deliveryId: delivery.id }
      } catch (err) {
        ctx.deliveries.claims.release(claimId, false)
        throw err
      }
    },
  },
  {
    name: "send.release",
    handle(payload, ctx) {
      ctx.deliveries.claims.release(requireString(payload, "claimId"), payload.delivered === true)
      return {}
    },
  },
]
