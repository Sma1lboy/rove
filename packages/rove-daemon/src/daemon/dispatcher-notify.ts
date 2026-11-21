/**
 * One plain line into a worker's dispatcher tab, so a coordinating session
 * learns what happened to a task it started without polling. No footer, no
 * provenance, nothing that asks for a reply.
 */

import type { DaemonTask } from "./contracts.ts"
import { logDaemonError } from "./crash-log.ts"
import { awaitingMenu } from "./handlers-queue.ts"
import type { DaemonHandlerContext } from "./handlers.ts"
import { ptyScopeFor } from "./pty-alias.ts"
import { displayTaskTitle } from "./serialize-task.ts"

/** `"<title>" (task <id>, branch <b>)`: how every dispatcher line names its worker. */
export function workerLabel(worker: DaemonTask): string {
  const branch = worker.branch ? `, branch ${worker.branch}` : ""
  return `"${displayTaskTitle(worker)}" (task ${worker.id}${branch})`
}

/**
 * Pastes `text` into the dispatcher tab of `worker`. Skipped when the worker
 * has no other dispatcher, the dispatcher is gone, or its tab is at a prompt
 * or menu (Enter would answer it). Returns whether the line was sent.
 */
export async function pasteToDispatcher(
  ctx: DaemonHandlerContext,
  worker: DaemonTask,
  text: string,
  opts: { readonly skipWhenRateLimited?: boolean } = {},
): Promise<boolean> {
  const to = worker.dispatcher
  if (!to || to.taskId === worker.id) return false
  const seat = ctx.orch.getTask(to.taskId)
  if (!seat || seat.deletion || !seat.worktreePath) return false
  const state = ctx.activity.stateOf(to.taskId, to.tabId)
  if (state === "permission_needed" || awaitingMenu(ctx, to.taskId, to.tabId)) return false
  // A dispatcher on the same wall would spend the paste on a turn that fails at once.
  if (opts.skipWhenRateLimited && state === "rate_limited") return false
  const result = await ctx.runtime
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
    .catch((err: unknown) => {
      logDaemonError("dispatcher-notify", err)
      return null
    })
  return result?.outcome === "delivered"
}

/** Minute precision in UTC: an agent reads it as-is, and the daemon knows no viewer's zone. */
function formatResumeAt(iso: string): string {
  const at = new Date(iso)
  return Number.isFinite(at.getTime()) ? `${at.toISOString().slice(0, 16).replace("T", " ")} UTC` : iso
}

/**
 * The worker just stopped on its engine's usage or billing limit. Says whether
 * Rove resumes it on its own (and when), so the dispatcher neither waits on
 * silence nor re-dispatches work that will continue.
 */
export async function tellDispatcherQuotaWall(
  ctx: DaemonHandlerContext,
  taskId: string,
  failure: "rate_limit" | "billing",
): Promise<boolean> {
  const worker = ctx.orch.getTask(taskId)
  if (!worker) return false
  const resumeAt = worker.quotaResume?.resumeAt
  const what =
    failure === "billing"
      ? "was stopped by a billing error; it needs a human before it can continue"
      : resumeAt
        ? `hit its usage limit; Rove resumes it automatically at ${formatResumeAt(resumeAt)}`
        : `hit its usage limit with no known reset; it waits until \`rove api resume-quota --task-id ${worker.id}\``
  return pasteToDispatcher(ctx, worker, `[ROVE WORKER] ${workerLabel(worker)} ${what}.`, {
    skipWhenRateLimited: true,
  })
}
