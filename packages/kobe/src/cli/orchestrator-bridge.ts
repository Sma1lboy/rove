/** Prefer a live daemon (so a TUI sees updates at once), else an in-process orchestrator. */

import type { KobeDaemonClient } from "@sma1lboy/kobe-daemon/client"
import { connectIfRunning } from "@sma1lboy/kobe-daemon/client/daemon-process"
import type { Orchestrator } from "../orchestrator/core.ts"

/** One-shot in-process orchestrator: reads `tasks.json` and shells git, no daemon. */
export async function openLocalOrchestrator(): Promise<Orchestrator> {
  const { TaskIndexStore } = await import("../orchestrator/index/store.ts")
  const { GitWorktreeManager } = await import("../orchestrator/worktree/manager.ts")
  const { Orchestrator } = await import("../orchestrator/core.ts")
  const store = new TaskIndexStore()
  await store.load()
  return new Orchestrator({ store, worktrees: new GitWorktreeManager() })
}

/** The daemon client is closed in `finally`; the local orchestrator is single-use. */
export async function withDaemonOrLocal<T>(bridge: {
  daemon: (client: KobeDaemonClient) => Promise<T>
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
