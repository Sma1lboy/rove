/**
 * Row menu "Archive" / "Unarchive". Archive hides the row and ends its idle
 * sessions, so it asks only two things: what happens to its children (move up
 * or go with it), and, when the daemon refuses with TASK_BUSY (an engine is
 * working or waiting on you), whether to retry with `force`. React-free for
 * unit tests, like `sync-base-action.ts`.
 */

import type { Task } from "@sma1lboy/rove-core/types/task.ts"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator"

const BUSY_RE = /\bTASK_BUSY: /
const REFUSAL_RE = /\bTASK_BUSY: ([\s\S]*)$/

export interface ArchiveTaskDeps {
  readonly orchestrator: Pick<RemoteOrchestrator, "archiveTask">
  /** The "archive anyway" question; resolves true to retry with force. */
  readonly confirmBusy: (title: string) => Promise<boolean>
  /** Asked when the task has listed children; `undefined` aborts. Absent → they are archived with it. */
  readonly pickChildren?: (title: string, count: number) => Promise<"promote" | "cascade" | undefined>
  readonly tasks?: () => readonly Pick<Task, "parentTaskId" | "archived" | "worktreeOnly">[]
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
  const children = archive
    ? (deps.tasks?.() ?? []).filter(
        (row) => row.parentTaskId === task.id && row.archived !== true && row.worktreeOnly !== true,
      )
    : []
  let promote = false
  if (children.length > 0 && deps.pickChildren) {
    const choice = await deps.pickChildren(title, children.length)
    if (choice === undefined) return false
    promote = choice === "promote"
  }
  const run = async (force: boolean): Promise<boolean> => {
    await deps.orchestrator.archiveTask(task.id, archive, force, promote)
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
