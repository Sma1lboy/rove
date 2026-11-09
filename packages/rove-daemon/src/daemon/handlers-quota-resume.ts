/**
 * `task.resumeQuota`: continue rate-limited tasks now instead of at their
 * quota reset — for when the owner raised the limit or switched accounts.
 * Same delivery and should-run check as the timer (`quota-resume.ts`).
 */

import { optionalString } from "./handler-validators.ts"
import { runnabilityDepsOf } from "./handlers-runnability.ts"
import type { DaemonRequestHandler } from "./handlers.ts"
import { type QuotaResumeOutcome, quotaWaitingTasks, resumeQuotaTask } from "./quota-resume.ts"
import type { SkipReason } from "./runnability-contracts.ts"
import { evaluateRunnability } from "./runnability.ts"

export const QUOTA_RESUME_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    name: "task.resumeQuota",
    // One paste per waiting task, serially.
    blocking: true,
    async handle(payload, ctx) {
      const taskId = optionalString(payload, "taskId")
      if (taskId !== undefined && !ctx.orch.getTask(taskId)) throw new Error(`task not found: ${taskId}`)
      const waiting = quotaWaitingTasks(ctx.orch.listTasks(), (id) => ctx.activity.entryOf(id, null))
      const targets = taskId === undefined ? waiting : waiting.filter((task) => task.id === taskId)
      const runnability = {
        check: (id: string, tabId: string | null, ignore?: readonly SkipReason[]) =>
          evaluateRunnability(runnabilityDepsOf(ctx), id, tabId, ignore ? { ignore } : {}),
      }
      const results: (QuotaResumeOutcome | { taskId: string; status: "failed"; error: string })[] = []
      for (const task of targets) {
        try {
          results.push(await resumeQuotaTask(ctx.orch, ctx.runtime, task, () => ctx.plugins ?? null, runnability))
        } catch (err) {
          results.push({ taskId: task.id, status: "failed", error: err instanceof Error ? err.message : String(err) })
        }
      }
      return { results }
    },
  },
]
