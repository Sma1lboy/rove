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
import { tc } from "./tui-copy.ts"
import { dialog, openNewSessionFrom, toast } from "./ui.ts"

interface Brief {
  readonly prompt?: string
  readonly repo: string
  readonly engine?: string
  readonly baseRef?: string
}

export async function openRetry(model: AppModel, task: TaskRow): Promise<void> {
  try {
    const { task: brief } = await model.client.request<{ task: Brief }>("task.get", { taskId: task.id })
    if (!brief.prompt) return void toast(t("menu.retryNoPrompt"), "error")
    const ungrouped = task.scratch || task.noProject
    openNewSessionFrom({
      ...(ungrouped ? { ungrouped: true as const } : { repo: brief.repo }),
      ...(brief.baseRef ? { baseBranch: brief.baseRef } : {}),
      ...(task.machine ? { machine: task.machine.id } : {}),
      prompt: brief.prompt,
      ...(brief.engine ? { engine: brief.engine } : {}),
      // A project's own checkout (main, or a directory task) retries in place; a managed task in a worktree.
      worktree: task.kind === "task",
      retryOf: { id: task.id, label: task.label },
    })
  } catch (err) {
    toast(errorText(err), "error")
  }
}

/** After the retry started: archive the original, escalating once when its engine is still working. */
export function offerArchiveOriginal(model: AppModel, original: { id: string; label: string }): void {
  const run = async (force: boolean) => {
    await model.client.request("task.archive", { taskId: original.id, archived: true, ...(force ? { force } : {}) })
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
