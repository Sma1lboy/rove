import type { DaemonOrchestrator, DaemonTask } from "./contracts.ts"
import { logDaemonError } from "./crash-log.ts"
import type { DaemonRuntimeAdapter } from "./runtime.ts"
import { auditDeletionFailed, auditDeletionRemoved } from "./task-deletion-audit.ts"

export interface TaskDeletionScheduler {
  enqueue(taskId: string): void
}

/** Deduplicated daemon owner for durable background task deletion. */
export class TaskDeletionRunner implements TaskDeletionScheduler {
  private readonly inFlight = new Map<string, Promise<void>>()

  constructor(
    // Narrowed to exactly what the runner touches: `getTask` is only here to
    // snapshot the task for the audit line before the index drops it, and
    // spelling that out keeps a caller from having to supply the whole
    // orchestrator surface.
    private readonly orch: Pick<DaemonOrchestrator, "beginTaskDeletion" | "finishTaskDeletion" | "getTask">,
    private readonly runtime: Pick<DaemonRuntimeAdapter, "tearDownTaskSession">,
    private readonly clearTaskState: (taskId: string) => void | Promise<void>,
  ) {}

  enqueue(taskId: string): void {
    if (this.inFlight.has(taskId)) return
    const pending = Promise.resolve()
      .then(() => this.run(taskId))
      .catch((err) => logDaemonError("task-deletion", err))
      .finally(() => this.inFlight.delete(taskId))
    this.inFlight.set(taskId, pending)
  }

  resume(tasks: readonly DaemonTask[]): void {
    for (const task of tasks) {
      if (task.deletion?.phase === "queued" || task.deletion?.phase === "running") this.enqueue(task.id)
    }
  }

  /** Test seam: resolves when all jobs known at call time have settled. */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.inFlight.values()])
  }

  private async run(taskId: string): Promise<void> {
    if (!(await this.orch.beginTaskDeletion(taskId))) return
    // Snapshot the task BEFORE anything is destroyed: `finishTaskDeletion`
    // drops it from the index, so an audit line read afterwards would have
    // nothing but an id to report.
    const task = this.orch.getTask(taskId)
    await this.clearTaskState(taskId)
    await this.runtime.tearDownTaskSession(taskId).catch((err) => logDaemonError("task-deletion-session-teardown", err))
    try {
      await this.orch.finishTaskDeletion(taskId)
    } catch (err) {
      auditDeletionFailed(taskId, task, err)
      throw err
    }
    auditDeletionRemoved(taskId, task)
  }
}
