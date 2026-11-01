/**
 * `send --queue` and the queue verbs: a follow-up for a busy tab is held by the daemon and pasted when that
 * tab's turn ends (`prompt-queue.ts`), instead of landing mid-turn. Codex drops the work in flight when a
 * prompt is pasted into a running turn; Claude Code folds it into the running turn.
 */

import { canonicalEngineTab } from "@sma1lboy/rove-daemon/daemon/engine-tabs"
import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import type { DaemonRpc } from "../daemon-session.ts"
import { F } from "./flags.ts"
import { simpleRpc } from "./handler-helpers.ts"
import { readTabsSnapshot } from "./tab-snapshot.ts"
import { ApiError, type VerbContext, type VerbSpec, helpStep } from "./types.ts"

interface QueueAddReply {
  readonly queued: boolean
  readonly item?: { readonly id: string; readonly tabId: string }
  readonly position?: number
}

/** `--queue` with a flag that names another lane is a mistake, not a preference. */
export function assertQueueFlags(ctx: VerbContext, tab: string | undefined): void {
  if (!ctx.args.bool("queue")) return
  const clash =
    tab === "new"
      ? "--tab new"
      : ctx.args.bool("if-runnable")
        ? "--if-runnable"
        : ctx.args.bool("respawn")
          ? "--respawn"
          : null
  if (clash)
    throw new ApiError(
      `--queue waits for a running turn; it does not combine with ${clash}`,
      "BAD_FLAG",
      helpStep("send"),
    )
}

/**
 * With `--queue`: hold `text` for the tab when it is busy and answer for the send; null when the tab can
 * take it now, so the ordinary send path pastes it.
 */
export async function queueIfBusy(
  ctx: VerbContext,
  daemon: DaemonRpc,
  task: SerializedTask,
  tab: string | undefined,
  text: string,
): Promise<object | null> {
  if (!ctx.args.bool("queue")) return null
  const tabId = tab ?? canonicalEngineTab(readTabsSnapshot(task.id)?.tabs ?? [])?.id
  // No engine tab yet: nothing is running, so the send starts one now.
  if (!tabId) return null
  const reply = await daemon.request<QueueAddReply>("queue.add", {
    taskId: task.id,
    tabId,
    text,
    expectReport: ctx.args.bool("expect-report") === true,
  })
  if (!reply.queued || !reply.item) return null
  return { ok: true, taskId: task.id, tabId, queued: true, queueId: reply.item.id, position: reply.position }
}

export const QUEUE_LIST_VERB: VerbSpec = {
  name: "queue-list",
  group: "read",
  summary:
    "Prompts `send --queue` is holding for a busy tab, oldest first: {items:[{id, taskId, tabId, text, expectReport, at, lastError?}]}. Each is pasted when its tab's turn ends, one per turn; `lastError` says why the last hand-over did not land (it stays at the head). Held in the daemon's memory: a daemon restart drops them.",
  flags: [F.taskId(false)],
  handler: async (ctx) =>
    simpleRpc(ctx, "queue.list", ctx.args.str("task-id") ? { taskId: ctx.args.str("task-id") } : {}),
}

export const QUEUE_CANCEL_VERB: VerbSpec = {
  name: "queue-cancel",
  group: "drive",
  summary: "Take back a prompt `send --queue` is holding (`queue-list` gives the id): {cancelled: true|false}.",
  flags: [{ name: "id", type: "string", required: true, placeholder: "q-N", description: "The held prompt's id." }],
  handler: async (ctx) => simpleRpc(ctx, "queue.cancel", { id: ctx.args.require("id") }),
}
