import type { ReadableState } from "../lib/external-store.ts"
import type { Unsubscribe } from "../orchestrator/core.ts"
import type { Task } from "../types/task.ts"

/** Replay the task cache, then notify on changes. A failing listener never breaks delivery. */
export function subscribeTasksOp(
  tasks: ReadableState<Task[]>,
  listener: (snapshot: readonly Task[]) => void,
): Unsubscribe {
  try {
    listener(tasks())
  } catch (err) {
    console.error("[rove RemoteOrchestrator] task listener threw on subscribe:", err)
  }
  return tasks.subscribe(() => {
    try {
      listener(tasks.get())
    } catch (err) {
      console.error("[rove RemoteOrchestrator] task listener threw:", err)
    }
  })
}
