/**
 * The machine hub: one `RemoteOrchestrator` per machine, one merged task list.
 * Every machine is connected at once and its tasks stamped with a
 * {@link TaskOrigin}; there is no "current machine".
 *
 * With NO machines registered it does nothing: the local task signal is
 * returned unchanged, object identity included, so a zero-machine install
 * renders and serializes byte-for-byte as without this module.
 *
 * READ-ONLY across the tunnel: writes aimed at a remote task are refused by
 * {@link guardRemoteTaskRequests} instead of landing on the local daemon,
 * which would not know that id.
 */

import { KobeDaemonClient } from "@sma1lboy/kobe-daemon/client"
import { logClient, logClientError } from "@sma1lboy/kobe-daemon/client/client-log"
import { RemoteOrchestrator } from "../client/remote-orchestrator.ts"
import type { ReadableState } from "../lib/external-store.ts"
import { createStateCell } from "../lib/external-store.ts"
import { loadStateFile } from "../state/store.ts"
import type { Task } from "../types/task.ts"
import { discoverMachine } from "./discover.ts"
import {
  type MachineEntry,
  dedupeMachines,
  duplicateAliasOf,
  listMachines,
  readMachines,
  setMachineIdentity,
  updateMachine,
} from "./registry.ts"
import { type TunnelHandle, startTunnel } from "./tunnel.ts"

/** What a machine row in the sidebar renders from. */
export interface MachineStatus {
  readonly alias: string
  /** On-screen name — always the alias, never the hostname: a real hostname
   *  (`Nahuels-Mac-mini.local`) fills the sidebar rail. */
  readonly hostLabel: string
  /** The machine's own hostname, once a handshake reported it. */
  readonly hostname?: string
  readonly state: "connecting" | "online" | "offline" | "unsupported" | "mismatch"
  /** Remote build version, once a handshake succeeded. */
  readonly version?: string
  /** Set when this alias turned out to be a machine already registered under
   *  another name — the row is suppressed and `machine list` reports it. */
  readonly duplicateOf?: string
  /** Why the machine is not usable, for the row's tooltip / `machine list`. */
  readonly error?: string
}

interface MachineSlot {
  readonly entry: MachineEntry
  tunnel?: TunnelHandle
  orchestrator?: RemoteOrchestrator
  unsubscribe?: () => void
  tasks: readonly Task[]
}

export class MachineHub {
  private readonly slots = new Map<string, MachineSlot>()
  private readonly machinesAcc = createStateCell<readonly MachineStatus[]>([], "machines.status")
  private readonly mergedAcc = createStateCell<Task[]>([], "machines.tasks")
  private localUnsubscribe: (() => void) | null = null
  private disposed = false

  constructor(private readonly local: RemoteOrchestrator) {}

  /** Registered machines and their live connection state. */
  machinesSignal(): ReadableState<readonly MachineStatus[]> {
    return this.machinesAcc
  }

  /** With no machine registered, the LOCAL signal itself (same identity). */
  tasksSignal(): ReadableState<Task[]> {
    if (this.slots.size === 0) return this.local.tasksSignal()
    return this.mergedAcc
  }

  /** Task ids that live on a machine other than this one. */
  remoteTaskIds(): ReadonlySet<string> {
    const ids = new Set<string>()
    for (const slot of this.slots.values()) for (const task of slot.tasks) ids.add(String(task.id))
    return ids
  }

  /**
   * SYNCHRONOUS on purpose: `tasksSignal()` picks its cell by whether any
   * machine exists, so slots must be in place before the UI mounts. Connections
   * are not awaited — an asleep machine must never delay the awake ones.
   */
  attach(): void {
    const entries = dedupeMachines(listMachines())
    if (entries.length === 0) return
    for (const entry of entries) {
      this.slots.set(entry.alias, { entry, tasks: [] })
    }
    this.publishStatuses()
    this.localUnsubscribe = this.local.tasksSignal().subscribe(() => this.republishTasks())
    this.republishTasks()
    for (const entry of entries) void this.connect(entry)
  }

  private async connect(entry: MachineEntry): Promise<void> {
    const slot = this.slots.get(entry.alias)
    if (!slot || this.disposed) return
    const found = await discoverMachine(entry.alias, entry)
    if (this.disposed) return
    // A failed probe falls back to the known socket paths (they don't move),
    // so the tunnel's backoff waits out a machine that is merely asleep.
    const sockets = found.ok ? { daemon: found.status.socketPath, pty: found.status.ptySocketPath } : entry.sockets
    if (!sockets) {
      this.setStatus(entry.alias, { state: "offline", error: found.ok ? undefined : found.message })
      return
    }
    if (found.ok) updateMachine(entry.alias, { sockets })
    const tunnel = startTunnel({
      alias: entry.alias,
      config: entry,
      remoteDaemonSocket: sockets.daemon,
      remotePtySocket: sockets.pty,
    })
    slot.tunnel = tunnel
    if (tunnel.state() === "unsupported") {
      this.setStatus(entry.alias, {
        state: "unsupported",
        error: "SSH unix-socket forwarding is not available on Windows",
      })
      return
    }
    tunnel.onState((state) => {
      if (state === "online") void this.openOrchestrator(entry, tunnel)
      // A dropped tunnel keeps the last snapshot on screen, greyed. See `docs/MACHINES.md`.
      else if (state === "offline") {
        this.setStatus(entry.alias, { state: "offline" })
        this.republishTasks()
      }
    })
    if (tunnel.state() === "online") await this.openOrchestrator(entry, tunnel)
  }

  private async openOrchestrator(entry: MachineEntry, tunnel: TunnelHandle): Promise<void> {
    const slot = this.slots.get(entry.alias)
    if (!slot || this.disposed || slot.orchestrator) return
    const client = new KobeDaemonClient(tunnel.daemonSocketPath)
    const orchestrator = new RemoteOrchestrator(client, {
      // `gui`, not `pane`: holds the remote daemon's refcount while its rows are
      // on screen; a pane watcher doesn't, and the remote daemon idle-stops ~3s
      // after its own last window closes, flapping the row.
      role: "gui",
      expectForeignHome: true,
      onPeerIdentity: (peer) => this.onPeerIdentity(entry.alias, peer),
    })
    slot.orchestrator = orchestrator
    try {
      await orchestrator.init()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.setStatus(entry.alias, { state: classifyHandshakeFailure(message), error: message })
      logClientError("machines", err)
      return
    }
    const stopTasks = orchestrator.tasksSignal().subscribe(() => {
      slot.tasks = orchestrator.tasksSignal().get()
      this.republishTasks()
    })
    // The daemon's connection state, not the tunnel's: a forwarded socket keeps
    // ACCEPTING after the far daemon dies (ssh answers locally).
    const stopConnection = orchestrator.connectionStateSignal().subscribe(() => {
      const connected = orchestrator.connectionStateSignal().get() === "online"
      if (this.slots.get(entry.alias) !== slot) return
      this.setStatus(entry.alias, { state: connected ? "online" : "offline" })
      this.republishTasks()
    })
    slot.unsubscribe = () => {
      stopTasks()
      stopConnection()
    }
    slot.tasks = orchestrator.tasksSignal().get()
    this.setStatus(entry.alias, { state: "online", version: orchestrator.daemonVersionSignal().get() ?? undefined })
    this.republishTasks()
    logClient("machines", `${entry.alias} online (${slot.tasks.length} tasks)`)
  }

  private onPeerIdentity(
    alias: string,
    peer: { hostname: string; homeDir: string; daemonPid: number; kobeVersion: string },
  ): void {
    if (!peer.hostname && !peer.homeDir) return
    const identity = { hostname: peer.hostname, homeDir: peer.homeDir, daemonPid: peer.daemonPid }
    setMachineIdentity(alias, identity)
    const duplicate = duplicateAliasOf(readMachines(loadStateFile()), alias, identity)
    this.setStatus(alias, {
      hostname: peer.hostname || undefined,
      version: peer.kobeVersion || undefined,
      ...(duplicate ? { duplicateOf: duplicate } : {}),
    })
  }

  private setStatus(alias: string, patch: Partial<MachineStatus>): void {
    const current = this.machinesAcc.get()
    const next = current.map((row) => (row.alias === alias ? { ...row, ...patch } : row))
    this.machinesAcc.set(next)
  }

  private publishStatuses(): void {
    this.machinesAcc.set(
      [...this.slots.values()].map((slot) => ({
        alias: slot.entry.alias,
        hostLabel: slot.entry.alias,
        state: "connecting" as const,
      })),
    )
  }

  /** Local tasks first, then each machine's in registration order. Local ones are
   *  stamped too, so no consumer has to read an absent `origin` as "local". */
  private republishTasks(): void {
    const merged: Task[] = this.local
      .tasksSignal()
      .get()
      .map((task) => stampOrigin(task, "local", "local"))
    for (const slot of this.slots.values()) {
      const status = this.machinesAcc.get().find((row) => row.alias === slot.entry.alias)
      if (status?.duplicateOf) continue
      const hostLabel = status?.hostLabel || slot.entry.alias
      const stale = status?.state !== "online"
      for (const task of slot.tasks) merged.push(stampOrigin(task, slot.entry.alias, hostLabel, stale))
    }
    this.mergedAcc.set(merged)
  }

  dispose(): void {
    this.disposed = true
    this.localUnsubscribe?.()
    for (const slot of this.slots.values()) {
      slot.unsubscribe?.()
      slot.orchestrator?.dispose()
      slot.tunnel?.stop()
    }
    this.slots.clear()
  }
}

/**
 * A protocol mismatch is that ONE machine's problem, shown on its row. Both
 * sides of `performInit` phrase it with "protocol vN", which nothing else in
 * the handshake path does. Everything else is `offline`.
 */
export function classifyHandshakeFailure(message: string): MachineStatus["state"] {
  return /protocol v\d/i.test(message) ? "mismatch" : "offline"
}

function stampOrigin(task: Task, machineId: string, hostLabel: string, stale = false): Task {
  return { ...task, origin: { machineId, hostLabel, ...(stale ? { stale: true } : {}) } }
}
