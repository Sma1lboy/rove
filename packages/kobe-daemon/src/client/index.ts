import { type Socket, connect } from "node:net"
import { StringDecoder } from "node:string_decoder"
import { readRoveEnv } from "../compat-env.ts"
import {
  BLOCKING_RPCS,
  type CellPixelSize,
  type ChannelName,
  type ChannelPayloads,
  type DaemonEventName,
  type DaemonFrame,
  type DaemonRequestName,
  type SubscribeRole,
  frameToLine,
} from "../daemon/protocol.ts"
import { logClientError } from "./client-log.ts"
import type { DaemonRpcClient } from "./rpc.ts"

export type DaemonEventHandler = (frame: Extract<DaemonFrame, { type: "event" }>) => void

/**
 * No response frame before the per-request deadline: the WEDGED-daemon signal
 * on a live connection. The client force-disconnects on it so the wedge joins
 * the ordinary disconnected→reconnect lifecycle instead of hanging a promise.
 */
export class RpcTimeoutError extends Error {
  constructor(name: string, timeoutMs: number) {
    super(`daemon rpc "${name}" timed out after ${timeoutMs}ms (daemon wedged?)`)
    this.name = "RpcTimeoutError"
  }
}

/**
 * Per-request deadline; a healthy daemon answers in well under a second.
 * Minutes-long requests are exempted by name (`BLOCKING_RPCS`).
 * `ROVE_RPC_TIMEOUT_MS` overrides it (0/negative disables); also the test seam.
 */
function rpcTimeoutMs(): number {
  const raw = readRoveEnv("RPC_TIMEOUT_MS")?.trim()
  if (raw) {
    const parsed = Number.parseInt(raw, 10)
    if (Number.isFinite(parsed)) return parsed
  }
  return 20_000
}

/**
 * Fires when the socket goes open→closed for ANY reason (daemon died, kernel
 * drop, `forceDisconnect`). The client never auto-retries: the daemon only
 * self-stops once the LAST subscriber is gone, so a drop under a live client
 * is rare and never transient; callers decide how to reconnect.
 */
export type LifecycleEvent = "close"

/**
 * JSON-line client over the daemon's unix socket. Emits `close` once on any
 * teardown; callers recover by calling {@link connect} again, except after
 * {@link close}, which blocks further connects.
 */
export class KobeDaemonClient implements DaemonRpcClient {
  private socket: Socket | null = null
  private buffer = ""
  private nextId = 1
  private readonly pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (err: Error) => void; timer?: ReturnType<typeof setTimeout> }
  >()
  private readonly handlers = new Map<DaemonEventName | "*", Set<DaemonEventHandler>>()
  private readonly lifecycleHandlers = new Map<LifecycleEvent, Set<() => void>>()
  /** Shared so racing `connect()` callers open one socket. */
  private connecting: Promise<void> | null = null
  /** Set by `close()`; a stray request must not revive a torn-down client. */
  private disposed = false

  constructor(readonly socketPath: string) {}

  connect(): Promise<void> {
    if (this.socket) return Promise.resolve()
    if (this.disposed) return Promise.reject(new Error("daemon client disposed"))
    if (this.connecting) return this.connecting
    const p = this.openSocket()
    this.connecting = p
    // Not `.finally`: its derived promise rejects with `p` and has no
    // handler, so Bun reports an unhandled rejection.
    const cleanup = (): void => {
      if (this.connecting === p) this.connecting = null
    }
    p.then(cleanup, cleanup)
    return p
  }

  /** True after {@link close}; the pane reconnect loop stops retrying on it. */
  get isDisposed(): boolean {
    return this.disposed
  }

  close(): void {
    this.disposed = true
    this.socket?.end()
    this.socket = null
    // `onSocketClose`'s stale guard skips the sweep now that socket is null,
    // so without this `pending` would leak every unanswered request.
    this.failPending()
  }

  /** Tear down the live socket without disposing, so {@link connect} can re-open cleanly. */
  forceDisconnect(): void {
    const socket = this.socket
    if (!socket) return
    this.socket = null
    socket.destroy()
    // As in `close()`: the guard skips the sweep, and leaks would pile up per reconnect.
    this.failPending()
  }

  /** Reject + clear every in-flight request (connection is gone for good). */
  private failPending(): void {
    if (this.pending.size === 0) return
    const err = new Error("daemon connection closed")
    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer)
      pending.reject(err)
    }
    this.pending.clear()
  }

  on(name: DaemonEventName | "*", handler: DaemonEventHandler): () => void {
    let set = this.handlers.get(name)
    if (!set) {
      set = new Set()
      this.handlers.set(name, set)
    }
    set.add(handler)
    return () => {
      set?.delete(handler)
      if (set?.size === 0) this.handlers.delete(name)
    }
  }

  /** {@link on} for a push channel, with the payload typed from {@link ChannelPayloads}. */
  onChannel<C extends ChannelName>(channel: C, handler: (payload: ChannelPayloads[C]) => void): () => void {
    return this.on(channel, (frame) => handler(frame.payload as ChannelPayloads[C]))
  }

  /**
   * Subscribe to push channels; the daemon replays each current value. The
   * `channels` filter is forward-compat only: the daemon sends everything.
   * `role`: `"gui"` holds the daemon alive; `"pane"` (default) receives
   * channels without keeping it running. See {@link SubscribeRole}.
   */
  subscribe(
    opts: { channels?: readonly ChannelName[]; role?: SubscribeRole; cellPixelSize?: CellPixelSize | null } = {},
  ): Promise<unknown> {
    const payload: {
      channels?: readonly ChannelName[]
      role?: SubscribeRole
      cellPixelWidth?: number
      cellPixelHeight?: number
    } = {}
    if (opts.channels) payload.channels = opts.channels
    if (opts.role) payload.role = opts.role
    // Flat optional fields: an unmeasured client sends nothing, and an older
    // daemon ignores what it does not know.
    if (opts.cellPixelSize) {
      payload.cellPixelWidth = opts.cellPixelSize.width
      payload.cellPixelHeight = opts.cellPixelSize.height
    }
    return this.request("subscribe", payload)
  }

  onLifecycle(name: LifecycleEvent, handler: () => void): () => void {
    let set = this.lifecycleHandlers.get(name)
    if (!set) {
      set = new Set()
      this.lifecycleHandlers.set(name, set)
    }
    set.add(handler)
    return () => {
      set?.delete(handler)
      if (set?.size === 0) this.lifecycleHandlers.delete(name)
    }
  }

  async request<T = unknown>(name: DaemonRequestName, payload?: unknown): Promise<T> {
    await this.connect()
    const socket = this.socket
    if (!socket) throw new Error("daemon connection is not open")
    const id = String(this.nextId++)
    const promise = new Promise<T>((resolve, reject) => {
      const entry: {
        resolve: (value: unknown) => void
        reject: (err: Error) => void
        timer?: ReturnType<typeof setTimeout>
      } = { resolve: (value) => resolve(value as T), reject }
      // Without a deadline a WEDGED daemon leaves this pending forever while
      // connectionState reads "online"; expiry takes the crashed-daemon path.
      const timeoutMs = rpcTimeoutMs()
      if (timeoutMs > 0 && !BLOCKING_RPCS.has(name)) {
        entry.timer = setTimeout(() => this.onRequestTimeout(id, name, timeoutMs), timeoutMs)
      }
      this.pending.set(id, entry)
    })
    socket.write(frameToLine({ type: "request", id, name, payload }))
    return promise
  }

  private onRequestTimeout(id: string, name: DaemonRequestName, timeoutMs: number): void {
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    pending.reject(new RpcTimeoutError(name, timeoutMs))
    // forceDisconnect() trips onSocketClose's stale guard, so no "close" is
    // emitted; emit it here or connectionState stays "online".
    this.forceDisconnect()
    this.emitLifecycle("close")
  }

  private openSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = connect(this.socketPath)
      this.socket = socket
      const onConnect = () => {
        socket.off("error", onError)
        // An un-listened 'error' (EPIPE, ECONNRESET) crashes the process;
        // destroy routes it through 'close', which rejects pending requests.
        socket.on("error", () => socket.destroy())
        resolve()
      }
      const onError = (err: Error) => {
        socket.off("connect", onConnect)
        if (this.socket === socket) this.socket = null
        reject(err)
      }
      socket.once("connect", onConnect)
      socket.once("error", onError)
      // Per socket: `StringDecoder` keeps a split multibyte char intact across
      // chunks (no U+FFFD), and a dropped socket's partial line must not
      // bleed into the next one's first frame.
      const decoder = new StringDecoder("utf8")
      this.buffer = ""
      socket.on("data", (chunk) => this.onData(decoder.write(chunk)))
      socket.on("close", () => this.onSocketClose(socket))
    })
  }

  private onSocketClose(which: Socket): void {
    // A prior socket's late close event must not tear down the current one.
    if (this.socket !== which) return
    this.socket = null
    this.failPending()
    this.emitLifecycle("close")
  }

  private emitLifecycle(name: LifecycleEvent): void {
    for (const handler of this.lifecycleHandlers.get(name) ?? []) {
      try {
        handler()
      } catch (err) {
        // One bad listener mustn't take the rest down.
        // eslint-disable-next-line no-console
        console.error(`[rove] lifecycle handler for "${name}" threw:`, err)
      }
    }
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    let nl = this.buffer.indexOf("\n")
    while (nl !== -1) {
      const line = this.buffer.slice(0, nl)
      this.buffer = this.buffer.slice(nl + 1)
      if (line.trim().length > 0) this.onLine(line)
      nl = this.buffer.indexOf("\n")
    }
  }

  private onLine(line: string): void {
    let frame: DaemonFrame
    try {
      frame = JSON.parse(line) as DaemonFrame
    } catch (err) {
      // A throw out of the 'data' callback stops all further delivery with
      // no 'close' (the pane goes deaf). Skip the line; the rest still drain.
      logClientError("client-frame", err)
      return
    }
    if (frame.type === "event") {
      this.emit(frame)
      return
    }
    if (frame.type !== "response") return
    const pending = this.pending.get(frame.id)
    if (!pending) return
    this.pending.delete(frame.id)
    if (pending.timer) clearTimeout(pending.timer)
    if (frame.error) {
      // Keep the wire error NAME so callers can branch on e.g. IllegalTransitionError.
      const err = new Error(frame.error.message)
      if (frame.error.name) err.name = frame.error.name
      pending.reject(err)
    } else pending.resolve(frame.payload)
  }

  private emit(frame: Extract<DaemonFrame, { type: "event" }>): void {
    // Per-handler try/catch: one throwing subscriber would skip the rest
    // (including "*") and escape the 'data' callback, freezing the pane with
    // the socket still open.
    for (const handler of this.handlers.get(frame.name) ?? []) {
      try {
        handler(frame)
      } catch (err) {
        logClientError("client-event", err)
      }
    }
    for (const handler of this.handlers.get("*") ?? []) {
      try {
        handler(frame)
      } catch (err) {
        logClientError("client-event", err)
      }
    }
  }
}
