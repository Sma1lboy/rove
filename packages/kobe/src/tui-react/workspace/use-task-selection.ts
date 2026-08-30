/**
 * Pure-TUI task selection + activation. Kept outside WorkspaceRoot so the
 * create-before-snapshot path is testable without mounting the full PTY host.
 */

import { errorMessage } from "../../lib/error-message.ts"
import { TASK_DELETING_CODE, TaskDeletingError } from "../../orchestrator/errors.ts"
import type { Task } from "../../types/task.ts"

/**
 * Map an activation failure onto the toast the user actually sees.
 *
 * Three shapes reach here and they need different words:
 *  - the task is mid-delete — nothing is wrong, the answer is "wait";
 *  - the project has no git repo yet — actionable, `git init` fixes it;
 *  - anything else — carry the raw reason so the user can act on it.
 *
 * `TaskDeletingError` is matched on its MESSAGE, not `instanceof`: the same
 * refusal is also raised daemon-side and the RPC layer rebuilds it as a plain
 * `Error`, dropping the class (see TASK_DELETING_CODE's own note).
 */
export function activationErrorMessage(
  error: unknown,
  translate: (key: string, vars?: Record<string, string>) => string,
): string {
  const message = errorMessage(error)
  if (message.includes(TASK_DELETING_CODE)) return translate("tasks.toast.worktreeErrorDeleting")
  if (/not a git repository|does not appear to be a git repo/i.test(message))
    return translate("tasks.toast.worktreeErrorNotGit")
  return translate("tasks.toast.worktreeErrorGeneric", { message })
}

type ActivateWorkspaceTaskOptions = {
  getTask: (id: string) => Task | undefined
  ensureWorktree: (id: string) => Promise<string>
  selectTask: (id: string) => void
  focusWorkspace: () => void
  reportError: (error: unknown) => void
  /** Last-intent guard: `false` after the await means a newer activation
   *  superseded this one, so selection/focus must not be applied. */
  isCurrent?: () => boolean
}

export async function activateWorkspaceTask(opts: ActivateWorkspaceTaskOptions, id: string): Promise<boolean> {
  const task = opts.getTask(id)
  if (task?.deletion) {
    opts.reportError(new TaskDeletingError(id))
    return false
  }
  // A create RPC can resolve before the daemon's task snapshot causes the
  // workspace host to render. An unknown task is therefore not proof that the
  // id is invalid — materialize by the authoritative RPC id and let the daemon
  // reject a genuinely missing task. `ensureWorktree` is idempotent, so known
  // materialized tasks can keep the local fast path below.
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
 * Boot/fallback selection, in trust order: the daemon's active task → the
 * persisted `lastActive` record (survives daemon confusion: a stale or
 * freshly-respawned daemon can replay a null/ancient focus while disk still
 * knows the truth) → the most recently UPDATED live task. Raw array order is
 * never used as a tiebreak — tasks.json leads with the oldest saved repo's
 * main task, which is how every SSH reconnect used to land on an untouched
 * project instead of the one being worked on.
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
  if (live.length > 0) return live.reduce((newest, task) => (task.updatedAt > newest.updatedAt ? task : newest))
  return tasks.find((task) => !task.deletion)
}
