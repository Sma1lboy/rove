/**
 * The machine hub: one `RemoteOrchestrator` per machine, one merged task list.
 *
 * Multiplexing, not switching. Every registered machine is connected at once
 * and its tasks are merged into the list the sidebar renders, each stamped
 * with a {@link TaskOrigin}. There is no "current machine" — the tree IS the
 * answer to "what is running where".
 *
 * With NO machines registered, this module does nothing at all: `attach`
 * returns early and the local orchestrator's task signal is handed back
 * unchanged, object identity included. That is the regression guard — the
 * zero-machine install must render and serialize byte-for-byte what it did
 * before machines existed.
 *
 * PR 1 is READ-ONLY across the tunnel. Writes aimed at a remote task are
 * refused by {@link guardRemoteTaskRequests} rather than silently landing on
 * the local daemon, which is what would otherwise happen: the local daemon
 * would simply not know that id.
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
  /** Remote hostname once known, else the alias. */
  readonly hostLabel: string
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

  /**
   * The task list the UI should render.
   *
   * Returns the LOCAL orchestrator's own signal when no machine is registered
   * — same cell, same identity, so nothing downstream can tell this class
   * exists. Only a real machine puts a merging cell in the path.
   */
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
   * Register every machine and start connecting.
   *
   * SYNCHRONOUS on purpose. The signals this returns to must be stable from
   * the first render — `tasksSignal()` picks its cell by whether any machine
   * exists — so the slots have to be in place before the UI mounts, while the
   * SSH probe behind each of them may take a lidded laptop's worth of time. A
   * machine that is asleep must never delay the ones that are awake, so each
   * slot reports its own state as it settles and none of them are awaited.
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
    // A probe that failed is not fatal when we already know where that machine
    // listens: the paths do not move, and reusing them lets the tunnel's own
    // backoff be what waits for a machine that is merely asleep.
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
      // A dropped tunnel does NOT drop the machine's rows: the last snapshot
      // stays on screen, greyed, because a laptop that closed its lid has not
      // stopped having those tasks. See `docs/MACHINES.md`.
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
      // A machine's tasks are read-only in PR 1, and holding a remote daemon
      // open from here would keep someone else's machine awake for a sidebar
      // row. `pane` reads without taking the GUI refcount.
      role: "pane",
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
    slot.unsubscribe = orchestrator.tasksSignal().subscribe(() => {
      slot.tasks = orchestrator.tasksSignal().get()
      this.republishTasks()
    })
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
      hostLabel: peer.hostname || alias,
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
        hostLabel: slot.entry.identity?.hostname || slot.entry.alias,
        state: "connecting" as const,
      })),
    )
  }

  /**
   * Rebuild the merged list: local tasks first (stamped `local`), then each
   * machine's, in registration order. Stamping the LOCAL ones too is what
   * makes `origin` answerable for every row rather than only the remote ones —
   * a consumer should never have to read "absent" as "local".
   */
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
 * What a failed handshake means for the machine's row.
 *
 * A protocol-range mismatch is that ONE machine's problem: the other machines
 * keep working and its row says what is wrong with it, rather than the failure
 * reaching the top level as if Rove were broken. `performInit` phrases that
 * rejection as "Rove daemon is protocol vN (min vM)" on the client side and
 * "daemon is protocol vN" on the daemon side — both name a protocol version,
 * which nothing else in the handshake path does.
 *
 * Everything else is `offline`: unreachable, wedged, or gone. Pure, so the
 * classification is tested without a daemon to be incompatible with.
 */
export function classifyHandshakeFailure(message: string): MachineStatus["state"] {
  return /protocol v\d/i.test(message) ? "mismatch" : "offline"
}

export function stampOrigin(task: Task, machineId: string, hostLabel: string, stale = false): Task {
  return { ...task, origin: { machineId, hostLabel, ...(stale ? { stale: true } : {}) } }
}
