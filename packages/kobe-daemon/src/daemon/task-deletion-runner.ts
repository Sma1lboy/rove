import type { DaemonOrchestrator, DaemonTask } from "./contracts.ts"
import { logDaemonError } from "./crash-log.ts"
import type { DaemonEventBus } from "./event-bus.ts"
import type { DaemonRuntimeAdapter } from "./runtime.ts"
import { auditDeletionFailed, auditDeletionRemoved } from "./task-deletion-audit.ts"

export interface TaskDeletionScheduler {
  enqueue(taskId: string): void
}

/** Deduplicated daemon owner for durable background task deletion. */
export class TaskDeletionRunner implements TaskDeletionScheduler {
  private readonly inFlight = new Map<string, Promise<void>>()

  constructor(
    // `getTask` only snapshots the task for the audit line.
    private readonly orch: Pick<DaemonOrchestrator, "beginTaskDeletion" | "finishTaskDeletion" | "getTask">,
    private readonly runtime: Pick<DaemonRuntimeAdapter, "tearDownTaskSession">,
    private readonly clearTaskState: (taskId: string) => void | Promise<void>,
    /**
     * Announces a FAILED deletion. UIs drop the row at `queued`, so without a
     * toast a reappearing `error` row reads as a glitch. Optional: a missing
     * bus costs the toast, never the deletion.
     */
    private readonly bus?: Pick<DaemonEventBus, "publish">,
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
    // Snapshot BEFORE `finishTaskDeletion` drops it from the index.
    const task = this.orch.getTask(taskId)
    await this.clearTaskState(taskId)
    await this.runtime.tearDownTaskSession(taskId).catch((err) => logDaemonError("task-deletion-session-teardown", err))
    try {
      await this.orch.finishTaskDeletion(taskId)
    } catch (err) {
      auditDeletionFailed(taskId, task, err)
      this.announceFailure(taskId, task, err)
      throw err
    }
    auditDeletionRemoved(taskId, task)
  }

  /** One toast per failed deletion, naming the task and git's own reason. */
  private announceFailure(taskId: string, task: DaemonTask | undefined, err: unknown): void {
    const reason = err instanceof Error ? err.message : String(err)
    this.bus?.publish("notice.event", {
      title: `Delete failed: ${task?.title || taskId}`,
      body: `${reason} — the worktree and the task are still there.`,
      kind: "error",
      taskId,
      at: Date.now(),
      source: "task-deletion",
    })
  }
}
