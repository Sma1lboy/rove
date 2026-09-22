/**
 * Non-spawning pane-orchestrator connect that never leaks a half-built
 * orchestrator.
 *
 * If `init()` throws after the socket opened (protocol-skew rejection, daemon
 * dying mid-handshake, malformed hello), an abandoned orchestrator keeps its
 * socket and its `role: "pane"` close handler starts a reconnect loop that
 * re-subscribes a client nobody reads — forever, in a days-lived pane.
 *
 *   - **NON-spawning** — `connectIfRunning()`, never `ensureDaemonReachable`:
 *     a helper pane must not resurrect an idle-stopped daemon (a gui owns its
 *     lifetime); no daemon → `null`, caller degrades.
 *   - **dispose-on-failure** — a thrown `init()` disposes the half-built
 *     orchestrator before returning `null`.
 *
 * The caller owns the LIVE orchestrator's teardown. A caller whose cleanup can
 * run while this promise is in flight (UiPrefsSync) adds a `disposed`-flag
 * check; see host-boot.tsx.
 */

import type { KobeDaemonClient } from "@sma1lboy/kobe-daemon/client"
import { logClient, logClientError } from "@sma1lboy/kobe-daemon/client/client-log"
import { connectIfRunning } from "@sma1lboy/kobe-daemon/client/daemon-process"
import type { ChannelName } from "@sma1lboy/kobe-daemon/daemon/protocol"
import { RemoteOrchestrator, type RemoteOrchestratorOptions } from "./remote-orchestrator.ts"

export interface ConnectPaneOrchestratorOptions {
  /** `[subsystem]` tag for the degrade/failure log lines (e.g. `"ui-prefs"`). */
  readonly logTag?: string
  /**
   * Per-channel subscribe filter for {@link RemoteOrchestrator}. Omit for every
   * channel; narrow for a single-purpose consumer (`["ui-prefs", "keybindings"]`).
   */
  readonly channels?: readonly ChannelName[]
  /** Connect step override for tests. Defaults to the non-spawning {@link connectIfRunning}. */
  readonly connect?: () => Promise<KobeDaemonClient | null>
  /** Extra {@link RemoteOrchestrator} options (role, ensureReachable). */
  readonly orchestratorOptions?: Omit<RemoteOrchestratorOptions, "channels">
}

/**
 * The live {@link RemoteOrchestrator}, or `null` when no daemon is running or
 * the handshake failed (half-built orchestrator disposed). Never throws.
 */
export async function connectPaneOrchestrator(
  options: ConnectPaneOrchestratorOptions = {},
): Promise<RemoteOrchestrator | null> {
  const tag = options.logTag ?? "orch-connect"
  const connect = options.connect ?? connectIfRunning
  let remote: RemoteOrchestrator | null = null
  try {
    const client = await connect()
    if (!client) {
      logClient(tag, "no daemon running — caller degrades")
      return null
    }
    remote = new RemoteOrchestrator(client, {
      ...options.orchestratorOptions,
      channels: options.channels,
    })
    await remote.init()
    return remote
  } catch (err) {
    logClientError(tag, err)
    // Must dispose: an abandoned one leaks the socket and a consumer-less reconnect loop.
    remote?.dispose()
    return null
  }
}
