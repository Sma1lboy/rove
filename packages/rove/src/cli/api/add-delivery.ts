/**
 * What `add` does to a task after the daemon created it, shared by the single
 * and the parallel path so they cannot drift: follow-up flags, the first
 * prompt's delivery, and the stored brief.
 */

import { deliveryFooter } from "@sma1lboy/rove-daemon/daemon/contracts"
import { roveApiInvocation } from "../../engine/interactive-command.ts"
import type { TaskStatus } from "../../types/task.ts"
import type { DaemonRpc } from "../daemon-session.ts"
import { type DeliveredPrompt, type PromptTarget, type VerbContext, promptMayHaveLanded } from "./types.ts"

/**
 * `--status` / `--pin` aren't create-time RPC fields — apply them as
 * follow-ups. Shared by the single and parallel paths so they cannot drift.
 * Returns whether anything was applied (so the caller can skip a `task.get`).
 */
export async function applyPostCreateFlags(
  daemon: DaemonRpc,
  taskId: string,
  args: VerbContext["args"],
): Promise<boolean> {
  const status = args.enumOf<TaskStatus>("status")
  if (status) await daemon.request("task.status", { taskId, status })
  const pin = args.bool("pin")
  if (pin !== undefined) await daemon.request("task.pin", { taskId, pinned: pin })
  const requireReport = args.bool("require-report")
  if (requireReport !== undefined) await daemon.request("task.requireReport", { taskId, required: requireReport })
  return Boolean(status) || pin !== undefined || requireReport !== undefined
}

/**
 * Deliver a new task's first prompt. A task created with `--require-report` (or
 * `--expect-report`) arms its delivery BEFORE the spawn, once the task and its
 * first tab are known; the footer rides the engine argv with the prompt. A
 * spawn that fails drops the delivery, as `send` does.
 */
export async function deliverArmed(
  ctx: VerbContext,
  daemon: DaemonRpc,
  taskId: string,
  target: PromptTarget,
  text: string,
): Promise<DeliveredPrompt & { deliveryId?: string }> {
  if (ctx.args.bool("require-report") !== true && ctx.args.bool("expect-report") !== true) {
    return ctx.runtime.deliverPrompt(daemon, target, text)
  }
  // A fresh task's first engine tab is always tab-1.
  const { deliveryId } = await daemon.request<{ deliveryId: string }>("delivery.arm", {
    taskId,
    tabId: "tab-1",
    promptHead: text,
  })
  const settle = (delivered: boolean) =>
    daemon.request("delivery.settle", { deliveryId, delivered, tabId: "tab-1" }).catch(() => {})
  try {
    const delivered = await ctx.runtime.deliverPrompt(
      daemon,
      target,
      `${text}\n\n${deliveryFooter(deliveryId, roveApiInvocation())}`,
    )
    // An unconfirmed launch keeps its delivery: the engine may still start with the prompt.
    await settle(promptMayHaveLanded(delivered))
    return { ...delivered, deliveryId }
  } catch (err) {
    await settle(false)
    throw err
  }
}

/**
 * Record the brief on the task. Resolves `false` (never rejects) when the
 * store refused it; callers must surface that.
 */
export async function persistPrompt(daemon: DaemonRpc, taskId: string, prompt: string): Promise<boolean> {
  try {
    await daemon.request("task.setPrompt", { taskId, prompt })
    return true
  } catch (err) {
    console.error(`[rove api add] task.setPrompt failed for ${taskId} — no "Run again" for this task:`, err)
    return false
  }
}
