/**
 * A client's view of the other machines: what the daemon's hub publishes on
 * `machines` (`daemon-hub.ts`), merged with this client's local tasks. Holds
 * no connection, so a machine added or removed from any shell shows up here
 * without a restart.
 *
 * With no machine registered the merged signal is the local task array itself
 * (same identity, same notification), so a zero-machine install renders and
 * notifies as without it.
 */

import type { RemoteOrchestrator } from "../client/remote-orchestrator.ts"
import type { ReadableState } from "../lib/external-store.ts"
import { createStateCell } from "../lib/external-store.ts"
import type { Task } from "../types/task.ts"
import { type MachineStatus, type RemoteLive, stampOrigin } from "./hub.ts"

const NO_LIVE: RemoteLive = { activity: new Map(), changes: new Map(), tokens: new Map() }

interface Remote {
  readonly machines: readonly MachineStatus[]
  readonly tasks: readonly Task[]
  readonly live: RemoteLive
}

/** The daemon's `machines` payload, or null for one this build can't read. */
export function decodeMachines(payload: unknown): Remote | null {
  const p = payload as { machines?: unknown; tasks?: unknown; live?: Record<string, unknown> } | null
  if (!p || !Array.isArray(p.machines) || !Array.isArray(p.tasks) || !p.live || typeof p.live !== "object") return null
  const map = (value: unknown) =>
    new Map(value && typeof value === "object" ? Object.entries(value as Record<string, never>) : [])
  return {
    machines: p.machines as MachineStatus[],
    tasks: p.tasks as Task[],
    live: { activity: map(p.live.activity), changes: map(p.live.changes), tokens: map(p.live.tokens) },
  }
}

export class MachineFeed {
  private readonly machinesAcc = createStateCell<readonly MachineStatus[]>([], "machines.status")
  /** The other machines' tasks, or null while none is registered. */
  private readonly remoteTasksAcc = createStateCell<readonly Task[] | null>(null, "machines.remoteTasks")
  private readonly tasksAcc: ReadableState<Task[]>
  private merged: { local: Task[]; remote: readonly Task[]; value: Task[] } | null = null
  private readonly liveAcc = createStateCell<RemoteLive>(NO_LIVE, "machines.live")
  private readonly stops: Array<() => void>

  constructor(private readonly local: RemoteOrchestrator) {
    this.tasksAcc = this.mergedTasks()
    const raw = local.rawChannelSignal("machines")
    const take = (): void => {
      const next = decodeMachines(raw.get())
      if (!next) return
      this.machinesAcc.set(next.machines)
      this.liveAcc.set(next.live)
      this.remoteTasksAcc.set(next.machines.length === 0 ? null : next.tasks)
    }
    this.stops = [raw.subscribe(take)]
    take()
  }

  /** Registered machines and their live connection state. */
  machinesSignal(): ReadableState<readonly MachineStatus[]> {
    return this.machinesAcc
  }

  /** Local tasks first, then each machine's. One cell for the feed's life, whatever gets registered. */
  tasksSignal(): ReadableState<Task[]> {
    return this.tasksAcc
  }

  /** The other machines' live readings (engine state, changes, tokens). */
  liveSignal(): ReadableState<RemoteLive> {
    return this.liveAcc
  }

  // Derived rather than forwarded: a local change wakes subscribers straight from the local cell.
  private mergedTasks(): ReadableState<Task[]> {
    const localTasks = this.local.tasksSignal()
    const get = (): Task[] => {
      const local = localTasks.get()
      const remote = this.remoteTasksAcc.get()
      if (remote === null) return local
      if (this.merged?.local !== local || this.merged.remote !== remote) {
        // Local ones are stamped too, so no consumer reads an absent `origin` as "local".
        const value = [...local.map((task) => stampOrigin(task, "local", "local")), ...remote]
        this.merged = { local, remote, value }
      }
      return this.merged.value
    }
    const state = get as ReadableState<Task[]>
    state.get = get
    state.subscribe = (listener) => {
      const stopLocal = localTasks.subscribe(listener)
      const stopRemote = this.remoteTasksAcc.subscribe(listener)
      return () => {
        stopLocal()
        stopRemote()
      }
    }
    return state
  }

  dispose(): void {
    for (const stop of this.stops) stop()
  }
}
