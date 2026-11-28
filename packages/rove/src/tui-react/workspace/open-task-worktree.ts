import { existsSync } from "node:fs"
import { t } from "@sma1lboy/rove-core/i18n/index.ts"
import { isDiskFull, userFacingErrorMessage } from "@sma1lboy/rove-core/lib/error-message.ts"
import type { Task } from "@sma1lboy/rove-core/types/task.ts"
import { detectWorktreeOpener, openWorktree } from "@sma1lboy/rove-core/worktree/worktree-opener.ts"

type OpenTaskWorktreeDeps = {
  taskPath?: string
  ensureWorktree: (id: string) => Promise<string>
  notifyError: (message: string) => void
  noEditorMessage: string
  openFailedMessage: (label: string) => string
}

/** Ensure a task worktree exists, then open it with the detected editor. */
export async function requestTaskWorktreeOpen(id: string, deps: OpenTaskWorktreeDeps): Promise<void> {
  let path = deps.taskPath
  if (!path || !existsSync(path)) {
    try {
      path = await deps.ensureWorktree(id)
    } catch (error) {
      deps.notifyError(
        isDiskFull(error)
          ? t("tasks.toast.noDiskSpace")
          : t("tasks.toast.worktreeErrorGeneric", { message: userFacingErrorMessage(error) }),
      )
      return
    }
  }
  if (!path || !existsSync(path)) return

  const opener = detectWorktreeOpener()
  if (!opener) {
    deps.notifyError(deps.noEditorMessage)
    return
  }
  if (!openWorktree(path, opener)) {
    deps.notifyError(deps.openFailedMessage(opener.label))
  }
}

/** The host's standard wiring for {@link requestTaskWorktreeOpen}: resolve
 *  the task's recorded path and use the stock toast copy. */
export function openTaskWorktreeFor(
  id: string,
  opts: {
    tasks: readonly Task[]
    ensureWorktree: (id: string) => Promise<string>
    notifyError: (message: string) => void
  },
): void {
  void requestTaskWorktreeOpen(id, {
    taskPath: opts.tasks.find((task) => task.id === id)?.worktreePath,
    ensureWorktree: opts.ensureWorktree,
    notifyError: opts.notifyError,
    noEditorMessage: t("tasks.toast.noEditor"),
    openFailedMessage: (label) => t("tasks.toast.openWorktreeFailed", { label }),
  })
}
