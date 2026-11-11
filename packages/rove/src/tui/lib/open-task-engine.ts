/** Open a new task's engine tab daemon-side, as `rove api add --start` does, so its row is never without a TTY. */

import { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import { defaultDaemonSocketPath } from "@sma1lboy/rove-daemon/daemon/paths"
import type { ApiEnvelope } from "@sma1lboy/rove-daemon/daemon/protocol"

/** Rejects with the verb's own message (`ENGINE_LIMIT: …`, `SESSION_FAILED: …`) when nothing started. */
export async function openTaskEngine(taskId: string): Promise<void> {
  const client = new RoveDaemonClient(defaultDaemonSocketPath())
  try {
    const envelope = await client.request<ApiEnvelope>("api.invoke", {
      verb: "tab-new",
      params: { "task-id": taskId, kind: "engine" },
    })
    if (!envelope.ok) throw new Error(`${envelope.error.code}: ${envelope.error.message}`)
  } finally {
    client.close()
  }
}
