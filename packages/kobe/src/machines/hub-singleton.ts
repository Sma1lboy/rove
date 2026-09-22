/**
 * The process's one {@link MachineHub} — a module singleton so it isn't threaded
 * through every component to the sidebar. Absent by default: every read then
 * answers "no machines" (pane hosts, test renders).
 */

import { useSyncExternalStore } from "react"
import type { RemoteOrchestrator } from "../client/remote-orchestrator.ts"
import type { MachineLayerEntry } from "../tui/panes/sidebar/machine-layer.ts"
import type { Task } from "../types/task.ts"
import type { MachineHub } from "./hub.ts"

let hub: MachineHub | null = null

export function setMachineHub(next: MachineHub | null): void {
  hub = next
}

const NO_MACHINES: readonly MachineLayerEntry[] = []

/** Without a hub, the orchestrator's own signal (same cell). */
export function useMergedTasks(orchestrator: RemoteOrchestrator): readonly Task[] {
  const state = hub ? hub.tasksSignal() : orchestrator.tasksSignal()
  return useSyncExternalStore(state.subscribe, state.get, state.get)
}

/** Registered machines, for the sidebar's machine layer. */
export function useMachineRows(): readonly MachineLayerEntry[] {
  const state = hub?.machinesSignal()
  const subscribe = state?.subscribe ?? noopSubscribe
  const get = state?.get ?? emptyRows
  return useSyncExternalStore(subscribe, get, get)
}

function noopSubscribe(): () => void {
  return () => {}
}
function emptyRows(): readonly MachineLayerEntry[] {
  return NO_MACHINES
}
