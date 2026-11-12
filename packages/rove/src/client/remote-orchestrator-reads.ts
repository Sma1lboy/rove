import type { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import type { ReadableState } from "../lib/external-store.ts"
import type { Unsubscribe } from "../orchestrator/core.ts"
import type { Task } from "../types/task.ts"
import { deserializeTask } from "./remote-orchestrator-payloads.ts"

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

/** Rows an older Rove added by itself for worktrees made outside it. */
export async function legacyAdoptedTasksOp(client: RoveDaemonClient): Promise<readonly Task[]> {
  const res = await client.request<{ tasks: SerializedTask[] }>("worktree.legacyAdopted", {})
  return res.tasks.map(deserializeTask)
}
