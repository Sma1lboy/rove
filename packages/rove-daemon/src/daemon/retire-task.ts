/** Deleting a task the daemon itself is done with (a finished routine run), on the path `task.delete` takes. */

import { deletionTargets } from "../task-tree.ts"
import type { DaemonOrchestrator } from "./contracts.ts"
import { auditDeletionRequested } from "./task-deletion-audit.ts"
import type { TaskDeletionScheduler } from "./task-deletion-runner.ts"

/**
 * Forced, because nobody is there to answer a dirty-worktree refusal: uncommitted work goes to a
 * salvage ref first, and the branch is never deleted.
 */
export function taskRetirer(
  orch: Pick<DaemonOrchestrator, "getTask" | "listTasks" | "prepareTaskDeletion">,
  deletions: TaskDeletionScheduler,
): (taskId: string) => Promise<void> {
  return async (taskId) => {
    const targets = deletionTargets(orch.listTasks(), taskId)
    for (const id of targets) auditDeletionRequested(id, orch.getTask(id), undefined, { force: true })
    if (await orch.prepareTaskDeletion(taskId, { force: true })) for (const id of targets) deletions.enqueue(id)
  }
}
