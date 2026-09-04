/**
 * Newline-delimited JSON client for the daemon unix socket — the push
 * surface the CLI can't give you (live channels). Request names/payloads:
 * kobe-daemon protocol.ts; channel payloads are host-versioned `unknown`.
 */

import { type Socket, createConnection } from "node:net"
import type { DaemonFrame } from "./contract.ts"

export interface RoveSocketOptions {
  /** Defaults to `process.env.ROVE_SOCKET_PATH`, then `KOBE_SOCKET_PATH`. */
  readonly socketPath?: string
}

/** @deprecated Use RoveSocketOptions. */
export type KobeSocketOptions = RoveSocketOptions

type Pending = { resolve: (payload: unknown) => void; reject: (err: Error) => void }

/** What the daemon answers `hello` with — the runtime compatibility check. */
export interface DaemonInfo {
  /** Wire-format version range the daemon speaks. */
  readonly protocolVersion: number
  readonly minProtocolVersion: number
  /** The daemon's BUILD version. Both spellings carry the same value; the
   *  wire field is `kobeVersion`. */
  readonly roveVersion: string
  readonly kobeVersion: string
  /** The channel names THIS daemon broadcasts — the answer to "does the host
   *  I'm talking to know this channel", which `DAEMON_CHANNELS` (what YOUR
   *  SDK was built against) cannot give. */
  readonly capabilities: readonly string[]
  readonly daemonPid?: number
  /** The daemon's state root; a plugin whose own home differs is talking to a
   *  foreign daemon. */
  readonly homeDir?: string
}

export class RoveSocket {
  private sock: Socket | null = null
  private buffer = ""
  private nextId = 1
  private readonly pending = new Map<string, Pending>()
  private eventHandler: ((name: string, payload: unknown) => void) | null = null
  private closeHandler: ((err: Error) => void) | null = null
  private closeNotified = false

  /** Connect; resolves once the socket is up (before any `hello`). */
  connect(opts: RoveSocketOptions = {}): Promise<void> {
    const path = opts.socketPath ?? process.env.ROVE_SOCKET_PATH ?? process.env.KOBE_SOCKET_PATH
    if (!path) return Promise.reject(new Error("ROVE_SOCKET_PATH is not set and no socketPath was given"))
    return new Promise((resolve, reject) => {
      const sock = createConnection(path, () => resolve())
      sock.setEncoding("utf8")
      sock.on("data", (chunk: string) => this.onData(chunk))
      sock.on("error", (err) => {
        reject(err)
        this.failAll(err)
      })
      sock.on("close", () => this.failAll(new Error("daemon socket closed")))
      this.sock = sock
    })
  }

  /** One request → its response payload (rejects on daemon error frames). */
  request<T = unknown>(name: string, payload?: unknown): Promise<T> {
    const sock = this.sock
    if (!sock) return Promise.reject(new Error("not connected — call connect() first"))
    const id = String(this.nextId++)
    const frame: DaemonFrame = { type: "request", id, name, payload }
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (p: unknown) => void, reject })
      sock.write(`${JSON.stringify(frame)}\n`)
    })
  }

  /**
   * Subscribe to broadcast channels (omit for all) and receive `event`
   * frames via `handler`. Role is always "pane": an SDK consumer must
   * never hold the daemon's GUI lifetime open.
   */
  async subscribe(handler: (name: string, payload: unknown) => void, channels?: readonly string[]): Promise<void> {
    this.eventHandler = handler
    await this.request("subscribe", { role: "pane", ...(channels ? { channels } : {}) })
  }

  /**
   * Ask the running daemon what it is: build version and the channel list it
   * actually broadcasts. This is the only runtime compatibility check —
   * your own SDK version cannot tell you what the HOST knows, and an
   * unknown channel name is dropped from a `subscribe` filter silently.
   */
  async hello(): Promise<DaemonInfo> {
    const raw = await this.request<Record<string, unknown>>("hello", {})
    const version = typeof raw.kobeVersion === "string" ? raw.kobeVersion : ""
    return {
      protocolVersion: Number(raw.protocolVersion ?? 0),
      minProtocolVersion: Number(raw.minProtocolVersion ?? 0),
      roveVersion: version,
      kobeVersion: version,
      capabilities: Array.isArray(raw.capabilities) ? (raw.capabilities as string[]) : [],
      ...(typeof raw.daemonPid === "number" ? { daemonPid: raw.daemonPid } : {}),
      ...(typeof raw.homeDir === "string" ? { homeDir: raw.homeDir } : {}),
    }
  }

  /**
   * Called once when the connection dies — a daemon restart, a crash, a
   * socket error. Without it a subscriber goes silently blind: the daemon's
   * `daemon.stopping` only covers a GRACEFUL stop, and a hosted pane's PTY
   * outlives the daemon, so the pane keeps drawing its last frame and looks
   * live. Reconnect from here (`new RoveSocket()` + connect + subscribe) or
   * tell the user the host is gone. Not called for your own `close()`.
   */
  onClose(handler: (err: Error) => void): void {
    this.closeHandler = handler
  }

  close(): void {
    this.closeNotified = true // deliberate teardown is not a lost connection
    this.sock?.end()
    this.sock = null
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    let idx = this.buffer.indexOf("\n")
    while (idx >= 0) {
      const line = this.buffer.slice(0, idx)
      this.buffer = this.buffer.slice(idx + 1)
      idx = this.buffer.indexOf("\n")
      if (!line.trim()) continue
      let frame: DaemonFrame
      try {
        frame = JSON.parse(line) as DaemonFrame
      } catch {
        continue // torn/foreign line — skip, never crash the plugin
      }
      if (frame.type === "response") {
        const waiter = this.pending.get(frame.id)
        if (!waiter) continue
        this.pending.delete(frame.id)
        if (frame.error) waiter.reject(new Error(frame.error.message))
        else waiter.resolve(frame.payload)
      } else if (frame.type === "event") {
        this.eventHandler?.(frame.name, frame.payload)
      }
    }
  }

  private failAll(err: Error): void {
    for (const waiter of this.pending.values()) waiter.reject(err)
    this.pending.clear()
    // Pending requests were the ONLY thing this used to fail. A subscriber
    // has no pending request, so it heard nothing and stayed blind forever.
    if (this.closeNotified) return
    this.closeNotified = true
    this.closeHandler?.(err)
  }
}

/** Compatibility alias for plugins written against the Kobe-named SDK. */
export { RoveSocket as KobeSocket }
