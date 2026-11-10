/**
 * When a tab shows "engine exited": the daemon's row status says the engine
 * PROCESS is gone (`reason: "dead"`, from the pty-host's exit record). The
 * keepAlive shell wrapper leaves a live shell behind, so the PTY itself says
 * nothing; terminal text is never read for this.
 */

import type { TabStatus } from "@sma1lboy/rove-daemon/daemon/row-status"
import type { TerminalTab } from "./terminal-tabs-core"
import type { HookTabState } from "./turn-state-merge"

export interface EngineExitView {
  /** The engine's exit code; null when the daemon did not record one (signal, unknown). */
  readonly code: number | null
}

/**
 * `retriedSince` is the death the user already retried: until the daemon
 * records a new status, the old `dead` is stale and must not re-draw the banner.
 * `engineRunning`: the live process probe found an engine in the session, which
 * outranks any recorded death (a Retry must never kill a healthy engine).
 */
export function engineExitOf(
  tab: TerminalTab,
  status: TabStatus | undefined,
  hook: HookTabState | undefined,
  retriedSince: number | undefined,
  engineRunning = false,
): EngineExitView | null {
  if (tab.kind !== "engine" || status?.reason !== "dead" || engineRunning) return null
  if (retriedSince === status.since) return null
  const code = hook?.detail?.exit?.code
  return { code: typeof code === "number" ? code : null }
}
