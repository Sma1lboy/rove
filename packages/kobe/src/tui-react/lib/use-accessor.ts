/** React adapter for the framework-free Orchestrator state interface. */

import { useSyncExternalStore } from "react"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator"
import { type ReadableState, createStateCell } from "../../lib/external-store"

export function useAccessor<T>(state: ReadableState<T>): T {
  return useSyncExternalStore(state.subscribe, state.get, state.get)
}

/** Stand-in for a surface mounted without an orchestrator — never notifies,
 *  so a no-daemon page reads as "not disconnected" rather than flashing a
 *  banner it has no evidence for. */
const NO_ORCHESTRATOR = createStateCell<"online">("online")

/**
 * True while the daemon SOCKET is down (`connectionStateSignal`), tolerating a
 * null orchestrator so it can be called unconditionally.
 *
 * The distinction this preserves is the point: a single failed RPC against a
 * live daemon is a transient, and does not set this. Only the socket dropping
 * does — which is what makes every daemon-fed surface on screen a photograph.
 */
export function useDaemonDown(orchestrator: RemoteOrchestrator | null): boolean {
  return useAccessor(orchestrator?.connectionStateSignal() ?? NO_ORCHESTRATOR) === "disconnected"
}
