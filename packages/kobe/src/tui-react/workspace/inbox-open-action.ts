import type { AttentionInboxItem, RemoteOrchestrator } from "../../client/remote-orchestrator"
import { notifyInboxRpcFailure } from "./inbox-rpc-errors"

type InboxOpenRpc = Pick<RemoteOrchestrator, "dismissAttention" | "dismissRoutineAttention">

/**
 * Opening an item RESOLVES it: the item is removed from the Inbox
 * (there is no read/unread lifecycle). A fresh event on the
 * same Task and Terminal Tab records a new item at the latest position.
 * Unavailable items are stale UI state and resolve the same way.
 */
export function requestInboxItemOpen(
  item: AttentionInboxItem,
  available: boolean,
  rpc: InboxOpenRpc,
  notifyError: (message: string) => void,
): boolean {
  notifyInboxRpcFailure(dismissEpisode(item, rpc), "dismiss", notifyError)
  return available
}

/**
 * Delete one episode, whichever thing it is about.
 *
 * A routine episode is addressed by its SCHEDULE: `attention.dismiss` takes a
 * taskId, and a routine that cannot run may never have produced one.
 */
export function dismissEpisode(item: AttentionInboxItem, rpc: InboxOpenRpc): Promise<boolean> {
  const automationId = item.detail?.routine?.automationId
  if (item.state === "routine_failed" && automationId) return rpc.dismissRoutineAttention(automationId)
  // A task-shaped episode always carries its task; the guard is for the type.
  return item.taskId === null ? Promise.resolve(false) : rpc.dismissAttention(item.taskId, item.tabId, item.at)
}
