/**
 * The page's one socket to rove-bridge: `{id, op, args}` requests answered by
 * id, `{event, data}` pushes fanned out by name. Same contract the phones
 * speak (docs/IOS.md); the token rides as a `Sec-WebSocket-Protocol` because a
 * browser cannot set `Authorization`. Reconnects with backoff like the phone
 * clients and replays `onOpen` hooks so subscriptions and terminals reattach.
 */

import { type Store, createStore } from "./store.ts"

export type ConnState = "connecting" | "open" | "retrying"

export interface Hello {
  readonly protocol: number
  readonly roveVersion: string
  readonly host: string
}

export interface ConnView {
  readonly state: ConnState
  readonly hello: Hello | null
  /** Consecutive failures since the last good connection. */
  readonly failures: number
}

export class BridgeRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

interface Pending {
  readonly resolve: (value: unknown) => void
  readonly reject: (err: Error) => void
  readonly progress?: (line: string) => void
}

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15000]
/** A woken page's socket gets this long to answer `hello` before it counts as dead. */
const WAKE_PROBE_MS = 4000
/** A new socket gets this long to open and answer its first `hello`. */
const CONNECT_DEADLINE_MS = 10_000

export class BridgeClient {
  readonly conn: Store<ConnView> = createStore<ConnView>({ state: "connecting", hello: null, failures: 0 })
  private ws: WebSocket | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private readonly listeners = new Map<string, Set<(data: unknown) => void>>()
  private readonly openHooks = new Set<() => void>()
  private retryTimer: number | null = null
  /** Drops `ws` unless a `hello` answers first: armed on connect and by a wake probe. */
  private deadline: number | null = null

  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  start(): void {
    this.connect()
    // A phone back from sleep may hold a socket that never fires `close`, or sit in a long backoff.
    const wake = () => {
      if (document.visibilityState === "visible") this.checkNow()
    }
    document.addEventListener("visibilitychange", wake)
    window.addEventListener("online", wake)
    window.addEventListener("pageshow", wake)
  }

  /** Reconnect now if retrying; if open, drop the socket unless it answers `hello` quickly. */
  private checkNow(): void {
    if (this.retryTimer !== null) {
      this.retryNow()
      return
    }
    const ws = this.ws
    if (!ws || this.conn.get().state !== "open" || this.deadline !== null) return
    this.armDeadline(ws, WAKE_PROBE_MS)
    this.request("hello").then(
      () => this.clearDeadline(),
      // Any reply, even an error, proves the socket is alive.
      (e) => {
        if (e instanceof BridgeRequestError && e.code !== "NOT_CONNECTED") this.clearDeadline()
      },
    )
  }

  private armDeadline(ws: WebSocket, ms: number): void {
    this.clearDeadline()
    this.deadline = window.setTimeout(() => this.lost(ws), ms)
  }

  private clearDeadline(): void {
    if (this.deadline !== null) window.clearTimeout(this.deadline)
    this.deadline = null
  }

  /** Run now if connected, and again after every reconnect. */
  onOpen(hook: () => void): () => void {
    this.openHooks.add(hook)
    if (this.conn.get().state === "open") hook()
    return () => this.openHooks.delete(hook)
  }

  on(event: string, handler: (data: unknown) => void): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(handler)
    return () => set.delete(handler)
  }

  /** `onProgress` receives the `op.progress` lines an op streams while it runs (a clone's git output). */
  request<T>(op: string, args: Record<string, unknown> = {}, onProgress?: (line: string) => void): Promise<T> {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new BridgeRequestError("NOT_CONNECTED", "not connected to rove"))
    }
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject, progress: onProgress })
      ws.send(JSON.stringify({ id, op, args }))
    })
  }

  private connect(): void {
    this.retryTimer = null
    const ws = new WebSocket(this.url, ["rove.v1", `rove.bearer.${this.token}`])
    this.ws = ws
    this.armDeadline(ws, CONNECT_DEADLINE_MS)
    ws.onmessage = (ev) => this.receive(String(ev.data))
    ws.onopen = () => {
      this.request<Hello>("hello").then(
        (hello) => {
          this.clearDeadline()
          this.conn.set({ state: "open", hello, failures: 0 })
          for (const hook of this.openHooks) hook()
        },
        () => this.lost(ws),
      )
    }
    ws.onclose = () => this.lost(ws)
  }

  private lost(ws: WebSocket): void {
    if (this.ws !== ws) return
    this.ws = null
    this.clearDeadline()
    ws.onopen = null
    ws.onclose = null
    ws.onmessage = null
    ws.close()
    for (const p of this.pending.values()) p.reject(new BridgeRequestError("NOT_CONNECTED", "connection lost"))
    this.pending.clear()
    const failures = this.conn.get().failures + 1
    this.conn.set({ state: "retrying", hello: this.conn.get().hello, failures })
    const delay = BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)]
    this.retryTimer = window.setTimeout(() => this.connect(), delay)
  }

  private receive(raw: string): void {
    let frame: unknown
    try {
      frame = JSON.parse(raw)
    } catch {
      return
    }
    if (!frame || typeof frame !== "object") return
    if ("event" in frame && typeof frame.event === "string") {
      const data = "data" in frame ? frame.data : undefined
      if (frame.event === "op.progress") {
        const p = data as { id?: unknown; line?: unknown } | undefined
        if (typeof p?.id === "number" && typeof p.line === "string") this.pending.get(p.id)?.progress?.(p.line)
        return
      }
      for (const handler of this.listeners.get(frame.event) ?? []) handler(data)
      return
    }
    if (!("id" in frame) || typeof frame.id !== "number") return
    const pending = this.pending.get(frame.id)
    if (!pending) return
    this.pending.delete(frame.id)
    if ("ok" in frame && frame.ok === true) {
      pending.resolve("result" in frame ? frame.result : undefined)
      return
    }
    const error = "error" in frame && frame.error && typeof frame.error === "object" ? frame.error : {}
    const code = "code" in error && typeof error.code === "string" ? error.code : "INTERNAL"
    const message = "message" in error && typeof error.message === "string" ? error.message : code
    pending.reject(new BridgeRequestError(code, message))
  }

  /** Retry now instead of waiting out the backoff (the status bar's reconnect). */
  retryNow(): void {
    if (this.retryTimer === null) return
    window.clearTimeout(this.retryTimer)
    this.connect()
  }
}

/** Same origin as the page: `rove --web` serves both, and the dev server proxies `/ws`. */
export function bridgeUrl(): string {
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:"
  return `${scheme}//${window.location.host}/ws`
}
