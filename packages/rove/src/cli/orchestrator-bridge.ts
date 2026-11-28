/** Prefer a live daemon (so a TUI sees updates at once), else an in-process orchestrator. */

import type { Orchestrator } from "@sma1lboy/rove-core/orchestrator/core.ts"
import type { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import { connectIfRunning } from "@sma1lboy/rove-daemon/client/daemon-process"

/** One-shot in-process orchestrator: reads `tasks.json` and shells git, no daemon. */
export async function openLocalOrchestrator(): Promise<Orchestrator> {
  const { TaskIndexStore } = await import("@sma1lboy/rove-core/orchestrator/index/store.ts")
  const { GitWorktreeManager } = await import("@sma1lboy/rove-core/orchestrator/worktree/manager.ts")
  const { Orchestrator } = await import("@sma1lboy/rove-core/orchestrator/core.ts")
  const store = new TaskIndexStore()
  await store.load()
  return new Orchestrator({ store, worktrees: new GitWorktreeManager() })
}

/** The daemon client is closed in `finally`; the local orchestrator is single-use. */
export async function withDaemonOrLocal<T>(bridge: {
  daemon: (client: RoveDaemonClient) => Promise<T>
  local: (orch: Orchestrator) => Promise<T>
}): Promise<T> {
  const client = await connectIfRunning()
  if (client) {
    try {
      return await bridge.daemon(client)
    } finally {
      client.close()
    }
  }
  const orch = await openLocalOrchestrator()
  return bridge.local(orch)
}
