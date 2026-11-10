/**
 * Row menu "Archive" / "Unarchive". Archive only hides the row and its
 * children, so it needs no confirm, except when the daemon refuses with
 * TASK_BUSY (an engine in the subtree is working or waiting on you): then the
 * user is asked once and "Archive anyway" retries with `force`. React-free for
 * unit tests, like `sync-base-action.ts`.
 */

import type { RemoteOrchestrator } from "../../client/remote-orchestrator"
import type { Task } from "../../types/task"

const BUSY_RE = /\bTASK_BUSY: /
const REFUSAL_RE = /\b(?:TASK_BUSY|MAIN_TASK): ([\s\S]*)$/

export interface ArchiveTaskDeps {
  readonly orchestrator: Pick<RemoteOrchestrator, "archiveTask">
  /** The "archive anyway" question; resolves true to retry with force. */
  readonly confirmBusy: (title: string) => Promise<boolean>
  readonly notifyInfo: (message: string) => void
  readonly notifyError: (message: string) => void
  readonly t: (key: string, params?: Record<string, string | number>) => string
}

/** Flip `task.archived`; true when it changed. Every outcome is reported. */
export async function archiveTaskAction(
  deps: ArchiveTaskDeps,
  task: Pick<Task, "id" | "title" | "archived">,
): Promise<boolean> {
  const { t } = deps
  const archive = task.archived !== true
  const title = task.title
  const run = async (force: boolean): Promise<boolean> => {
    await deps.orchestrator.archiveTask(task.id, archive, force)
    deps.notifyInfo(archive ? t("tasks.archive.done", { title }) : t("tasks.archive.restored", { title }))
    return true
  }
  const fail = (err: unknown): false => {
    const msg = err instanceof Error ? err.message : String(err)
    const error = REFUSAL_RE.exec(msg)?.[1] ?? msg
    deps.notifyError(archive ? t("tasks.archive.failed", { error }) : t("tasks.archive.restoreFailed", { error }))
    return false
  }
  try {
    return await run(false)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!archive || !BUSY_RE.test(msg)) return fail(err)
    if (!(await deps.confirmBusy(title))) return false
    try {
      return await run(true)
    } catch (retryErr) {
      return fail(retryErr)
    }
  }
}
