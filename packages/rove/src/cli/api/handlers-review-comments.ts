/**
 * `review-comments` — the unresolved review threads on a task's PR, each with
 * its file and line, so an agent can work through review feedback from the
 * shell. The daemon runs `gh`; this verb only validates and passes through.
 */

import type { PrReviewCommentsResult } from "@sma1lboy/rove-daemon/daemon/pr-review-comments"
import { F } from "./flags.ts"
import { daemonOf } from "./handler-helpers.ts"
import type { VerbContext, VerbSpec } from "./types.ts"

async function handleReviewComments(ctx: VerbContext): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const taskId = ctx.args.require("task-id")
  // An unknown task fails here with TASK_NOT_FOUND rather than reading as "no PR".
  await daemon.request("task.get", { taskId })
  const res = await daemon.request<PrReviewCommentsResult & { prNumber: number | null }>("pr.reviewComments", {
    taskId,
  })
  return { taskId, ...res }
}

export const REVIEW_COMMENTS_VERB: VerbSpec = {
  name: "review-comments",
  group: "read",
  summary:
    "List the unresolved review threads on a task's PR, each with its `path` and `line`, so an agent can address review feedback. Returns { taskId, prNumber, threads: [{ path, line, outdated, comments: [{ author, body, url }] }], totalUnresolved }; at most 50 threads. `prNumber: null` = the task has no PR yet. `unavailable` = GitHub could not be asked (gh missing or signed out), which says nothing about open threads.",
  flags: [F.taskId()],
  handler: handleReviewComments,
}
