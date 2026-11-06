/** Keep one attempt of a round: mark it, then offer to archive the others (the rail's archive, behind a confirm). */

import type { TaskRow } from "rove-bridge/protocol"
import { BridgeRequestError } from "./bridge.ts"
import { ConfirmDialog, errorText } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { dialog, toast } from "./ui.ts"

/** Archives the attempts still listed (an archived row leaves the feed), so a retry after a partial run skips the done ones. */
async function archiveAttempts(model: AppModel, ids: readonly string[], force: boolean): Promise<void> {
  const live = new Set(model.tasks.get()?.tasks.map((task) => task.id))
  let done = 0
  try {
    for (const taskId of ids.filter((id) => live.has(id))) {
      await model.client.request("task.archive", { taskId, archived: true, ...(force ? { force: true } : {}) })
      done++
    }
  } catch (err) {
    if (done > 0) toast(t("compare.archived", { count: done }))
    // A busy attempt goes back to the dialog, which offers "archive anyway".
    if (err instanceof BridgeRequestError && err.code === "TASK_BUSY") throw err
    toast(t("compare.archiveFailed", { error: errorText(err) }), "error")
    return
  }
  toast(t("compare.archived", { count: done }))
}

/** Marks `keep` as the round's one kept attempt (clearing a previous one), then asks whether to archive the rest. */
export async function keepAttempt(model: AppModel, keep: TaskRow, round: readonly TaskRow[]): Promise<void> {
  try {
    for (const other of round) {
      if (other.id !== keep.id && other.kept) await model.client.request("task.keep", { taskId: other.id, kept: false })
    }
    await model.client.request("task.keep", { taskId: keep.id, kept: true })
  } catch (err) {
    toast(t("compare.keepFailed", { error: errorText(err) }), "error")
    return
  }
  toast(t("compare.keptToast", { title: keep.label }))
  const others = round.filter((row) => row.id !== keep.id).map((row) => row.id)
  if (others.length === 0) return
  dialog.set(
    <ConfirmDialog
      title={t("compare.archiveTitle")}
      body={t("compare.archiveBody", { count: others.length })}
      confirmLabel={t("compare.archiveConfirm")}
      onConfirm={() => archiveAttempts(model, others, false)}
      escalate={{
        when: (err) => err instanceof BridgeRequestError && err.code === "TASK_BUSY",
        label: t("compare.archiveBusyConfirm"),
        title: t("compare.archiveBusyTitle"),
        body: () => t("compare.archiveBusyBody"),
        run: () => archiveAttempts(model, others, true),
      }}
    />,
  )
}

export async function unkeepAttempt(model: AppModel, row: TaskRow): Promise<void> {
  try {
    await model.client.request("task.keep", { taskId: row.id, kept: false })
    toast(t("compare.unkeptToast", { title: row.label }))
  } catch (err) {
    toast(t("compare.keepFailed", { error: errorText(err) }), "error")
  }
}
