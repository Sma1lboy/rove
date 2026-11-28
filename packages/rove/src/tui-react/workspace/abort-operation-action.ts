/**
 * Row menu "Abort paused merge or rebase": `git <op> --abort` in the row's
 * worktree, behind a confirm because it throws away any resolution made since
 * the operation stopped. React-free for unit tests.
 */

import { abortPausedOperation, pausedGitOperation } from "../../tui/ops/conflict-prompt"

export interface AbortOperationDeps {
  readonly confirm: (title: string, body: string, confirmLabel: string) => Promise<boolean>
  readonly notifyInfo: (message: string) => void
  readonly notifyError: (message: string) => void
  readonly t: (key: string, params?: Record<string, string | number>) => string
}

export async function abortOperationAction(deps: AbortOperationDeps, worktree: string, branch: string): Promise<void> {
  const { t } = deps
  const operation = pausedGitOperation(worktree)
  if (!operation) return deps.notifyError(t("files.toast.noPausedOperation"))
  const params = { op: operation, branch: branch || "HEAD" }
  const ok = await deps.confirm(
    t("tasks.abortOp.title", params),
    t("tasks.abortOp.body", params),
    t("tasks.abortOp.confirm", params),
  )
  if (!ok) return
  // Re-read after the dialog: the engine may have finished or aborted it meanwhile.
  const current = pausedGitOperation(worktree)
  if (current !== operation) {
    if (current === null) deps.notifyError(t("files.toast.noPausedOperation"))
    return
  }
  const error = await abortPausedOperation(worktree, operation)
  if (error === null) deps.notifyInfo(t("tasks.abortOp.done", params))
  else deps.notifyError(t("tasks.abortOp.failed", { ...params, error }))
}
