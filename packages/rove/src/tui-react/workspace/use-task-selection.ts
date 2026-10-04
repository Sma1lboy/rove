/**
 * Pure-TUI task selection + activation. Kept outside WorkspaceRoot so the
 * create-before-snapshot path is testable without mounting the full PTY host.
 */

import { errorMessage, userFacingErrorMessage } from "../../lib/error-message.ts"
import { TASK_DELETING_CODE, TaskDeletingError } from "../../orchestrator/errors.ts"
import type { Task } from "../../types/task.ts"

/**
 * Toast wording by failure shape: mid-delete ("wait"), no git repo
 * (`git init` fixes it), or the reason minus the worktree layer's
 * `create(): …` throw-site prefix. `TaskDeletingError` is matched by MESSAGE:
 * the daemon-side copy arrives over RPC as a plain `Error` (see
 * TASK_DELETING_CODE).
 */
export function activationErrorMessage(
  error: unknown,
  translate: (key: string, vars?: Record<string, string>) => string,
): string {
  const message = errorMessage(error)
  if (message.includes(TASK_DELETING_CODE)) return translate("tasks.toast.worktreeErrorDeleting")
  if (/not a git repository|does not appear to be a git repo/i.test(message))
    return translate("tasks.toast.worktreeErrorNotGit")
  return translate("tasks.toast.worktreeErrorGeneric", { message: userFacingErrorMessage(error) })
}

type ActivateWorkspaceTaskOptions = {
  getTask: (id: string) => Task | undefined
  ensureWorktree: (id: string) => Promise<string>
  selectTask: (id: string) => void
  focusWorkspace: () => void
  reportError: (error: unknown) => void
  /** `false` after the await = a newer activation superseded this one. */
  isCurrent?: () => boolean
}

export async function activateWorkspaceTask(opts: ActivateWorkspaceTaskOptions, id: string): Promise<boolean> {
  const task = opts.getTask(id)
  if (task?.deletion) {
    opts.reportError(new TaskDeletingError(id))
    return false
  }
  // A task on ANOTHER machine: materializing would hit the local daemon, which
  // doesn't know the id ("task not found"). Select it and stop.
  if (task?.origin && task.origin.machineId !== "local") {
    opts.selectTask(id)
    opts.focusWorkspace()
    return true
  }
  // A create RPC can resolve before the snapshot renders it, so an unknown task
  // isn't proof of a bad id: materialize by the RPC id and let the daemon
  // reject a truly missing one. `ensureWorktree` is idempotent.
  if (!task?.worktreePath) {
    try {
      await opts.ensureWorktree(id)
    } catch (error) {
      opts.reportError(error)
      return false
    }
  }
  if (opts.isCurrent?.() === false) return false
  opts.selectTask(id)
  opts.focusWorkspace()
  return true
}

/**
 * Trust order: daemon's active task → persisted `lastActive` (a stale or
 * respawned daemon can replay a null/ancient focus) → most recently UPDATED
 * live task. Never raw array order: tasks.json leads with the oldest saved
 * repo, which lands every SSH reconnect on an untouched project.
 *
 * The recency fallback SKIPS routine sessions: a 03:00 firing makes one the
 * newest task, yet its row is folded away, so booting onto it leaves the
 * cursor on an invisible row. An explicit active/lastActive id still wins.
 */
export function firstSelectableTask(
  tasks: readonly Task[],
  activeId: string | null,
  lastActiveId?: string | null,
): Task | undefined {
  const alive = (id: string | null | undefined): Task | undefined =>
    id ? tasks.find((task) => task.id === id && !task.deletion) : undefined
  const active = alive(activeId) ?? alive(lastActiveId)
  if (active) return active
  const live = tasks.filter((task) => !task.deletion)
  const newest = (pool: readonly Task[]): Task | undefined =>
    pool.length > 0 ? pool.reduce((best, task) => (task.updatedAt > best.updatedAt ? task : best)) : undefined
  return (
    newest(live.filter((task) => task.routine === undefined)) ?? newest(live) ?? tasks.find((task) => !task.deletion)
  )
}
