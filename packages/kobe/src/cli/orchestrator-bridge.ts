/**
 * Daemon-if-running / in-process-orchestrator fallback bridge.
 *
 * Several CLI subcommands (`add`, `remove`, `adopt`, `kobe <path>`) prefer a
 * live daemon so a TUI sees updates immediately, but must still work when the
 * daemon is absent. This module centralizes that fallback so callers don't
 * repeat the connect/close + orchestrator construction dance.
 */

import type { KobeDaemonClient } from "@sma1lboy/kobe-daemon/client"
import { connectIfRunning } from "@sma1lboy/kobe-daemon/client/daemon-process"
import type { Orchestrator } from "../orchestrator/core.ts"

/** Build a short-lived in-process orchestrator (store + git manager) for
 *  a one-shot CLI command. No daemon, no socket — just reads `tasks.json`
 *  and shells git. */
export async function openLocalOrchestrator(): Promise<Orchestrator> {
  const { TaskIndexStore } = await import("../orchestrator/index/store.ts")
  const { GitWorktreeManager } = await import("../orchestrator/worktree/manager.ts")
  const { Orchestrator } = await import("../orchestrator/core.ts")
  const store = new TaskIndexStore()
  await store.load()
  return new Orchestrator({ store, worktrees: new GitWorktreeManager() })
}

/**
 * Run work against a running daemon if one exists, otherwise against a
 * freshly-built local orchestrator. The daemon client is closed in a
 * `finally`; the local orchestrator is single-use and discarded.
 */
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
