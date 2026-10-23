/** Reading a task's {@link PtyScope} (whose PTYs its liveness, tab reads and prompt routing cover) from the daemon. */

import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { type PtyScope, ptyScopeFor } from "@sma1lboy/rove-daemon/daemon/pty-alias"
import type { DaemonRpc } from "../daemon-session.ts"

/** Advisory like the task list it reads: unreadable, the scope claims nothing. A row given with its alias wins over the listed one. */
export async function ptyScopeOf(daemon: DaemonRpc, task: Pick<SerializedTask, "id" | "ptyAlias">): Promise<PtyScope> {
  const listed = await daemon.request<{ tasks: SerializedTask[] }>("task.list", {}).catch(() => ({ tasks: [] }))
  const scope = ptyScopeFor(listed.tasks, task.id)
  return task.ptyAlias ? { ...scope, alias: task.ptyAlias } : scope
}
