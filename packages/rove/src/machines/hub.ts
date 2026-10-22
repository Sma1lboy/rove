/**
 * The machine hub: one `RemoteOrchestrator` per machine, their tasks stamped
 * with a {@link TaskOrigin}; there is no "current machine". It runs in the
 * daemon (`daemon-hub.ts`), which publishes what it holds on `machines`;
 * clients read that (`feed.ts`), so a machine added or removed from any shell
 * reaches every client.
 *
 * Writes to a remote task go through the verb forwarding in `forward.ts`
 * (`rove api`, `api.invoke`, the TUI's remote tabs); terminals attach that
 * machine's PTY host directly over the forwarded socket.
 */

import { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import { logClient, logClientError } from "@sma1lboy/rove-daemon/client/client-log"
import type { ChannelName } from "@sma1lboy/rove-daemon/daemon/protocol"
import type { TaskEngineState } from "../client/remote-orchestrator-payloads.ts"
import type { RowTokenMap } from "../client/remote-orchestrator-row-tokens.ts"
import type { WorktreeChangesMap } from "../client/remote-orchestrator-worktree-changes.ts"
import { RemoteOrchestrator } from "../client/remote-orchestrator.ts"
import type { ReadableState } from "../lib/external-store.ts"
import { createStateCell } from "../lib/external-store.ts"
import { loadStateFile } from "../state/store.ts"
import type { Task } from "../types/task.ts"
import { discoverMachine, learnedFrom } from "./discover.ts"
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

/**
 * What the other machines' daemons push about their own tasks, merged: engine state by task id,
 * worktree changes by (that machine's) worktree path, token chips by task id. Task ids are unique
 * across machines, and a worktree path only matches the rows of the machine that reported it.
 */
export interface RemoteLive {
  readonly activity: ReadonlyMap<string, TaskEngineState>
  readonly changes: WorktreeChangesMap
  readonly tokens: RowTokenMap
}

const NO_LIVE: RemoteLive = { activity: new Map(), changes: new Map(), tokens: new Map() }

interface MachineSlot {
  entry: MachineEntry
  tunnel?: TunnelHandle
  orchestrator?: RemoteOrchestrator
  unsubscribe?: () => void
  tasks: readonly Task[]
}

/** What the hub reads from each machine's daemon. Never `machines`: a peer whose hub reads ours must not wake ours. */
const PEER_CHANNELS: readonly ChannelName[] = ["task.snapshot", "engine-state", "worktree.changes", "task.tokens"]

export class MachineHub {
  private readonly slots = new Map<string, MachineSlot>()
  private readonly machinesAcc = createStateCell<readonly MachineStatus[]>([], "machines.status")
  private readonly tasksAcc = createStateCell<Task[]>([], "machines.tasks")
  private readonly liveAcc = createStateCell<RemoteLive>(NO_LIVE, "machines.live")
  private disposed = false

  /** Registered machines and their live connection state. */
  machinesSignal(): ReadableState<readonly MachineStatus[]> {
    return this.machinesAcc
  }

  /** The other machines' tasks, stamped with their origin, in registration order. */
  tasksSignal(): ReadableState<Task[]> {
    return this.tasksAcc
  }

  /** The other machines' live readings (engine state, changes, tokens), re-published on every push. */
  liveSignal(): ReadableState<RemoteLive> {
    return this.liveAcc
  }

  /** Task ids that live on a machine other than this one. */
  remoteTaskIds(): ReadonlySet<string> {
    const ids = new Set<string>()
    for (const slot of this.slots.values()) for (const task of slot.tasks) ids.add(String(task.id))
    return ids
  }

  /**
   * Match the registry: connect machines added since the last call, drop removed
   * ones, reconnect one whose address changed. Call again on every registry
   * change. Connections are not awaited — an asleep machine must never delay
   * the awake ones.
   */
  sync(entries: readonly MachineEntry[] = dedupeMachines(listMachines())): void {
    if (this.disposed) return
    const wanted = new Map(entries.map((entry) => [entry.alias, entry]))
    const fresh: MachineEntry[] = []
    for (const [alias, slot] of this.slots) {
      const next = wanted.get(alias)
      if (next && sameAddress(slot.entry, next)) slot.entry = next
      else this.drop(alias)
    }
    for (const entry of entries) {
      if (this.slots.has(entry.alias)) continue
      this.slots.set(entry.alias, { entry, tasks: [] })
      fresh.push(entry)
    }
    if (fresh.length === 0 && wanted.size === this.slots.size && this.machinesAcc.get().length === wanted.size) return
    const known = new Map(this.machinesAcc.get().map((row) => [row.alias, row]))
    this.machinesAcc.set(
      [...this.slots.values()].map(
        (slot) =>
          known.get(slot.entry.alias) ?? {
            alias: slot.entry.alias,
            hostLabel: slot.entry.alias,
            state: "connecting" as const,
          },
      ),
    )
    this.republishTasks()
    this.republishLive()
    for (const entry of fresh) void this.connect(entry)
  }

  private drop(alias: string): void {
    const slot = this.slots.get(alias)
    if (!slot) return
    this.slots.delete(alias)
    slot.unsubscribe?.()
    slot.orchestrator?.dispose()
    slot.tunnel?.stop()
  }

  private async connect(entry: MachineEntry): Promise<void> {
    const slot = this.slots.get(entry.alias)
    if (!slot || this.disposed) return
    const found = await discoverMachine(entry.alias, entry)
    if (this.disposed || this.slots.get(entry.alias) !== slot) return
    // A failed probe falls back to the known socket paths (they don't move),
    // so the tunnel's backoff waits out a machine that is merely asleep.
    const sockets = found.ok ? { daemon: found.status.socketPath, pty: found.status.ptySocketPath } : entry.sockets
    if (!sockets) {
      this.setStatus(entry.alias, { state: "offline", error: found.ok ? undefined : found.message })
      return
    }
    const learned = found.ok ? learnedFrom(found) : {}
    if (found.ok) updateMachine(entry.alias, learned)
    const tunnel = startTunnel({
      alias: entry.alias,
      config: { ...entry, ...learned, sockets },
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
      if (this.slots.get(entry.alias) !== slot) return
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
    const client = new RoveDaemonClient(tunnel.daemonSocketPath)
    const orchestrator = new RemoteOrchestrator(client, {
      // `gui`, not `pane`: holds the remote daemon's refcount while its rows are
      // on screen; a pane watcher doesn't, and the remote daemon idle-stops ~3s
      // after its own last window closes, flapping the row.
      role: "gui",
      channels: PEER_CHANNELS,
      expectForeignHome: true,
      onPeerIdentity: (peer) => this.onPeerIdentity(entry.alias, peer),
    })
    slot.orchestrator = orchestrator
    try {
      await orchestrator.init()
      if (this.slots.get(entry.alias) !== slot) return
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
    const live = [
      orchestrator.engineStateSignal(),
      orchestrator.worktreeChangesSignal(),
      orchestrator.rowTokensSignal(),
    ].map((signal) => signal.subscribe(() => this.republishLive()))
    slot.unsubscribe = () => {
      stopTasks()
      stopConnection()
      for (const stop of live) stop()
    }
    slot.tasks = orchestrator.tasksSignal().get()
    this.setStatus(entry.alias, { state: "online", version: orchestrator.daemonVersionSignal().get() ?? undefined })
    this.republishTasks()
    this.republishLive()
    logClient("machines", `${entry.alias} online (${slot.tasks.length} tasks)`)
  }

  private republishLive(): void {
    const activity = new Map<string, TaskEngineState>()
    const changes = new Map<string, WorktreeChangesMap extends ReadonlyMap<string, infer V> ? V : never>()
    const tokens = new Map<string, RowTokenMap extends ReadonlyMap<string, infer V> ? V : never>()
    for (const slot of this.slots.values()) {
      const o = slot.orchestrator
      if (!o) continue
      for (const [id, state] of o.engineStateSignal().get()) activity.set(id, state)
      for (const [path, change] of o.worktreeChangesSignal().get() ?? []) changes.set(path, change)
      for (const [id, chips] of o.rowTokensSignal().get()) tokens.set(id, chips)
    }
    this.liveAcc.set({ activity, changes, tokens })
  }

  private onPeerIdentity(
    alias: string,
    peer: { hostname: string; homeDir: string; daemonPid: number; roveVersion: string },
  ): void {
    if (!peer.hostname && !peer.homeDir) return
    const identity = { hostname: peer.hostname, homeDir: peer.homeDir, daemonPid: peer.daemonPid }
    setMachineIdentity(alias, identity)
    const duplicate = duplicateAliasOf(readMachines(loadStateFile()), alias, identity)
    this.setStatus(alias, {
      hostname: peer.hostname || undefined,
      version: peer.roveVersion || undefined,
      ...(duplicate ? { duplicateOf: duplicate } : {}),
    })
  }

  private setStatus(alias: string, patch: Partial<MachineStatus>): void {
    const current = this.machinesAcc.get()
    const next = current.map((row) => (row.alias === alias ? { ...row, ...patch } : row))
    this.machinesAcc.set(next)
  }

  private republishTasks(): void {
    const merged: Task[] = []
    for (const slot of this.slots.values()) {
      const status = this.machinesAcc.get().find((row) => row.alias === slot.entry.alias)
      if (status?.duplicateOf) continue
      const hostLabel = status?.hostLabel || slot.entry.alias
      const stale = status?.state !== "online"
      for (const task of slot.tasks) merged.push(stampOrigin(task, slot.entry.alias, hostLabel, stale))
    }
    this.tasksAcc.set(merged)
  }

  dispose(): void {
    this.disposed = true
    for (const alias of [...this.slots.keys()]) this.drop(alias)
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

/** What a connection is made from; identity, cached sockets and `roveBin` are learned, not addressed. */
function sameAddress(a: MachineEntry, b: MachineEntry): boolean {
  return (
    a.host === b.host && a.user === b.user && a.port === b.port && JSON.stringify(a.auth) === JSON.stringify(b.auth)
  )
}

export function stampOrigin(task: Task, machineId: string, hostLabel: string, stale = false): Task {
  return { ...task, origin: { machineId, hostLabel, ...(stale ? { stale: true } : {}) } }
}
