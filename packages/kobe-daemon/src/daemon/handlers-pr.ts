/**
 * `pr.*` daemon RPC handlers.
 *
 * One entry today: the on-demand failing-check log read behind the sidebar's
 * "Fix failing checks". Its own module for the same reason as
 * `handlers-worktree.ts` — the registry is grouped by RPC-name prefix — and
 * because the work itself (two `gh` spawns) lives in `pr-failing-checks.ts`,
 * leaving only the task lookup here.
 *
 * Not web-exposed: it shells `gh` in a worktree on this machine, and the web
 * allowlist is a security contract, not a convenience list.
 */

import { requireString } from "./handler-validators.ts"
import type { DaemonRequestHandler } from "./handlers.ts"
import { readFailingChecks } from "./pr-failing-checks.ts"

export const PR_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    name: "pr.failingChecks",
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const task = ctx.orch?.getTask(taskId)
      // No task, no local worktree, or no PR number: nothing to look up. An
      // empty result (rather than an error) is what the caller already handles
      // for "gh had nothing to say".
      const prNumber = task?.prStatus?.number
      if (!task?.worktreePath || typeof prNumber !== "number") return { checks: [], totalFailing: 0 }
      return await readFailingChecks({ worktreePath: task.worktreePath, prNumber })
    },
  },
]
