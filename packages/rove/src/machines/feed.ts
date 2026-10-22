/**
 * A client's view of the other machines: what the daemon's hub publishes on
 * `machines` (`daemon-hub.ts`), merged with this client's local tasks. Holds
 * no connection, so a machine added or removed from any shell shows up here
 * without a restart.
 *
 * With no machine registered the merged signal carries the local task array
 * itself (same identity), so a zero-machine install renders as without it.
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

const NONE: Remote = { machines: [], tasks: [], live: NO_LIVE }

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
  private remote: Remote = NONE
  private readonly machinesAcc = createStateCell<readonly MachineStatus[]>([], "machines.status")
  private readonly tasksAcc: ReturnType<typeof createStateCell<Task[]>>
  private readonly liveAcc = createStateCell<RemoteLive>(NO_LIVE, "machines.live")
  private readonly stops: Array<() => void>

  constructor(private readonly local: RemoteOrchestrator) {
    this.tasksAcc = createStateCell<Task[]>(local.tasksSignal().get(), "machines.tasks")
    const raw = local.rawChannelSignal("machines")
    const take = (): void => {
      const next = decodeMachines(raw.get())
      if (!next) return
      this.remote = next
      this.machinesAcc.set(next.machines)
      this.liveAcc.set(next.live)
      this.merge()
    }
    this.stops = [raw.subscribe(take), local.tasksSignal().subscribe(() => this.merge())]
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

  private merge(): void {
    const local = this.local.tasksSignal().get()
    if (this.remote.machines.length === 0) {
      this.tasksAcc.set(local)
      return
    }
    // Local ones are stamped too, so no consumer reads an absent `origin` as "local".
    this.tasksAcc.set([...local.map((task) => stampOrigin(task, "local", "local")), ...this.remote.tasks])
  }

  dispose(): void {
    for (const stop of this.stops) stop()
  }
}
