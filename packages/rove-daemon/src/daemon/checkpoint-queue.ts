import { logDaemonError } from "./crash-log.ts"

/**
 * Serializes checkpoint work per task: the auto-trigger at turn-complete and
 * the `checkpoint` / `rewind` verbs all rewrite the same refs and tree, so a
 * rewind must never interleave with a snapshot of the tree it is rewriting.
 */
export class CheckpointQueue {
  private readonly tails = new Map<string, Promise<unknown>>()

  /** Runs `job` after every earlier job of `taskId`; its own failure does not poison the next. */
  run<T>(taskId: string, job: () => Promise<T>): Promise<T> {
    const result = (this.tails.get(taskId) ?? Promise.resolve()).then(job, job)
    const tail = result.catch(() => undefined)
    this.tails.set(taskId, tail)
    void tail.then(() => {
      if (this.tails.get(taskId) === tail) this.tails.delete(taskId)
    })
    return result
  }

  /** Fire-and-forget: a turn-complete hook reply never waits on git. */
  schedule(taskId: string, job: () => Promise<unknown>): void {
    this.run(taskId, job).catch((err) => logDaemonError("checkpoint", err))
  }

  /** Test seam: resolves when all jobs known at call time have settled. */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.tails.values()])
  }
}
