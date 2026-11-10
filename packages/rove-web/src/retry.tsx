/**
 * Retry with an edited prompt: the task's own first prompt, project, engine and worktree choice reopen in New
 * session, and Start makes a fresh sibling (not a child). Once that has started the composer offers to archive
 * the original, which hides it and stops nothing.
 */

import type { TaskRow } from "rove-bridge/protocol"
import { BridgeRequestError } from "./bridge.ts"
import { ConfirmDialog, errorText } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { type RetryBrief, retrySeed } from "./retry-seed.ts"
import { tc } from "./tui-copy.ts"
import { dialog, openNewSessionFrom, toast } from "./ui.ts"

export async function openRetry(model: AppModel, task: TaskRow): Promise<void> {
  try {
    const { task: brief } = await model.client.request<{ task: Omit<RetryBrief, "prompt"> & { prompt?: string } }>(
      "task.get",
      { taskId: task.id },
    )
    if (!brief.prompt) return void toast(t("menu.retryNoPrompt"), "error")
    openNewSessionFrom(retrySeed(task, { ...brief, prompt: brief.prompt }))
  } catch (err) {
    toast(errorText(err), "error")
  }
}

/** After the retry started: archive the original, escalating once when its engine is still working. */
export function offerArchiveOriginal(model: AppModel, original: { id: string; label: string }): void {
  const run = async (force: boolean) => {
    await model.act("task.archive", { taskId: original.id, archived: true, ...(force ? { force } : {}) })
    toast(tc("tasks", "archive.done", { title: original.label }))
  }
  dialog.set(
    <ConfirmDialog
      title={t("newSession.retryArchiveTitle", { title: original.label })}
      body={t("newSession.retryArchiveBody")}
      confirmLabel={tc("tasks", "menu.archive")}
      onConfirm={() => run(false)}
      escalate={{
        when: (err) => err instanceof BridgeRequestError && err.code === "TASK_BUSY",
        label: tc("tasks", "archive.busyConfirm"),
        title: tc("tasks", "archive.busyTitle"),
        body: () => tc("tasks", "archive.busyBody", { title: original.label }),
        run: () => run(true),
      }}
    />,
  )
}
