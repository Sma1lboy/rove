/**
 * Acknowledging an Inbox episode (TUI `dismissEpisode` / `openItem` in `inbox-open-action.ts`,
 * `use-inbox-host.ts`). A routine episode's subject is a schedule, so it is cleared by its
 * automation id and opening it lands on the Routines page, not a task.
 */

import type { AttentionRow } from "rove-bridge/protocol"
import { isRoutineState } from "./inbox.ts"
import type { AppModel } from "./model.ts"
import { closeDialog, page, routineFocus, toast } from "./ui.ts"

/**
 * Delete one episode, whichever thing it is about. A decision is answered, never dismissed. A
 * `report_missing` episode is keyed by its delivery and survives an open: only an explicit ack
 * clears it, since it keeps blocking should-run until the owner does.
 */
export async function dismissEpisode(model: AppModel, row: AttentionRow, explicit = false): Promise<void> {
  let method = "attention.dismiss"
  let args: Record<string, string>
  if (isRoutineState(row.state)) {
    if (!row.automationId) return
    method = "attention.dismissRoutine"
    args = { automationId: row.automationId }
  } else {
    if (row.gateId || row.state === "decision_needed") return
    if (row.state === "report_missing" && !explicit) return
    if (row.taskId === null) return
    args = {
      taskId: row.taskId,
      ...(row.tabId ? { tabId: row.tabId } : {}),
      ...(row.deliveryId ? { deliveryId: row.deliveryId } : {}),
    }
  }
  await model.client.request(method, args).catch((err) => toast(String(err), "error"))
}

export function openRoutineEpisode(model: AppModel, row: AttentionRow): void {
  void dismissEpisode(model, row)
  closeDialog()
  routineFocus.set(row.automationId ?? null)
  page.set("routines")
}
