/**
 * `resume-quota` — continue rate-limited tasks now instead of at their quota
 * reset. The daemon does the work (`task.resumeQuota`) with the same paste
 * and should-run check as the reset timer.
 */

import { F } from "./flags.ts"
import { daemonOf } from "./handler-helpers.ts"
import { ApiError, type VerbContext, type VerbSpec } from "./types.ts"

interface ResumeResult {
  readonly taskId: string
  readonly status: "resumed" | "not-delivered" | "declined" | "failed"
  readonly reason?: string
  readonly error?: string
}

async function resumeQuota(ctx: VerbContext): Promise<unknown> {
  const taskId = ctx.args.str("task-id")
  const all = ctx.args.bool("all") ?? false
  if (taskId !== undefined && all) throw new ApiError("pass --task-id or --all, not both", "BAD_FLAG")
  if (taskId === undefined && !all) throw new ApiError("resume-quota needs --task-id ID or --all", "MISSING_TARGET")
  const { results } = await daemonOf(ctx).request<{ results: ResumeResult[] }>(
    "task.resumeQuota",
    taskId !== undefined ? { taskId } : {},
  )
  if (taskId !== undefined && results.length === 0) {
    throw new ApiError(`task ${taskId} is not waiting on a quota reset`, "NOT_RATE_LIMITED", {
      taskId,
      hint: "only a task whose engine hit its usage limit can be resumed early — `collect` shows .activity.state",
      nextCommandArgs: ["api", "collect", "--task-id", taskId],
    })
  }
  const count = (status: ResumeResult["status"]) => results.filter((r) => r.status === status).length
  return {
    count: results.length,
    resumed: count("resumed"),
    failures: results.length - count("resumed"),
    results,
  }
}

export const RESUME_QUOTA_VERB: VerbSpec = {
  name: "resume-quota",
  group: "drive",
  summary:
    "Continue a task parked on its engine's usage limit now, instead of waiting for the quota window to reset — for when the limit was raised or the engine signed in to another account. Types the same continue prompt the reset timer would, into the still-live session, and clears the armed resume. A task counts as waiting when it has an armed quota resume or its engine reports `rate_limited` (a billing stop is excluded: it needs a human). Each task gets the same should-run check the timer uses, minus the quota itself, so a task awaiting its owner, already running or at a permission prompt is declined, not typed into. Returns { count, resumed, failures, results }; each result has taskId and status resumed, not-delivered (no live engine to type into), declined (with the should-run .reason) or failed (.error). --task-id on a task that is not waiting fails with NOT_RATE_LIMITED; --all with none waiting returns count 0.",
  flags: [
    F.taskId(false),
    {
      name: "all",
      type: "bool",
      description:
        "Resume every task on this machine that is waiting on a quota reset. Mutually exclusive with --task-id.",
    },
  ],
  handler: resumeQuota,
}
