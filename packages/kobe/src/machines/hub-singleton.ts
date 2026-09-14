/**
 * The process's one {@link MachineHub}, and the hooks that read it.
 *
 * A module-level singleton, like `getDefaultPtyRegistry()`: the hub is a
 * process-lifetime resource created during boot, and threading it as a prop
 * would mean widening every component between the workspace root and the
 * sidebar for something none of them use.
 *
 * Absent by default. Every read below answers "no machines" when nothing has
 * been set, so a pane host, a test render and any process that never boots the
 * workspace behave exactly as they did before machines existed.
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

export function machineHub(): MachineHub | null {
  return hub
}

const NO_MACHINES: readonly MachineLayerEntry[] = []

/**
 * The task list to render: the hub's merged one when machines are registered,
 * the orchestrator's own signal otherwise — the SAME cell, so nothing
 * downstream can tell the hub exists.
 */
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
