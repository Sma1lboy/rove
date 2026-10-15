/**
 * Opening a routine episode (TUI `openItem` in `use-inbox-host.ts`): the subject is a schedule, so
 * the episode is cleared by its automation id and the Routines page opens, not a task.
 */

import type { AttentionRow } from "rove-bridge/protocol"
import type { AppModel } from "./model.ts"
import { closeDialog, page, routineFocus, toast } from "./ui.ts"

export function dismissRoutineEpisode(model: AppModel, row: AttentionRow): void {
  if (!row.automationId) return
  void model.client
    .request("attention.dismissRoutine", { automationId: row.automationId })
    .catch((err) => toast(String(err), "error"))
}

export function openRoutineEpisode(model: AppModel, row: AttentionRow): void {
  dismissRoutineEpisode(model, row)
  closeDialog()
  routineFocus.set(row.automationId ?? null)
  page.set("routines")
}
