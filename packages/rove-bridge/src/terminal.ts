/**
 * One phone connection's view of the PTY Host: attach to EXISTING hosted
 * sessions (the same ones the TUI shows), forward their bytes, and write the
 * phone's keystrokes back. Each connection owns its own PTY Host socket, so a
 * dropped phone detaches everything it attached in one step.
 *
 * Never spawns: a key the host does not list is refused, because `pty.open`
 * on a missing key would start a bare shell nobody asked for.
 */

import type {
  PtyDataEventPayload,
  PtyExitEventPayload,
  PtyOpenResult,
  PtyPeekResult,
  PtySizeEventPayload,
} from "@sma1lboy/rove-daemon/daemon/protocol"
import type { PtySessionInfo } from "@sma1lboy/rove-daemon/daemon/pty-host"
import { BridgeError, pushEvent } from "./protocol.ts"
import { TermFlow } from "./terminal-flow.ts"

/** The slice of `RoveDaemonClient` the forwarder uses (faked in tests). */
export interface PtyHostClient {
  request<T = unknown>(
    name: "pty.list" | "pty.open" | "pty.peek" | "pty.write" | "pty.resize" | "pty.detach",
    payload?: unknown,
  ): Promise<T>
  on(name: "pty.data" | "pty.exit" | "pty.size", handler: (frame: { payload: unknown }) => void): () => void
  close(): void
}

export interface AttachResult {
  readonly stream: string
  readonly alive: boolean
  /** base64 raw VT bytes, as the host ring holds them. */
  readonly replay: string
  /** Dead, and only peeked: a pty-host restart froze it (a plain exited session is `alive: false` without this). */
  readonly restored?: true
  /** The PTY's size after the attach (absent from pre-size hosts): a size-less attach adopts it. */
  readonly cols?: number
  readonly rows?: number
}

/** How often a size-less attach on a host that pushes no `pty.size` asks for the PTY's size. */
const SIZE_POLL_MS = 1000

export class TerminalForwarder {
  private readonly attached = new Set<string>()
  private readonly offs: Array<() => void>
  private readonly flow: TermFlow
  /** Size-less attaches on a host that pushes no `pty.size`: the size and offset last seen. */
  private readonly polled = new Map<string, { cols?: number; rows?: number; offset: number }>()
  private pollTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly pty: PtyHostClient,
    private readonly send: (frame: string) => void,
    private readonly pollMs = SIZE_POLL_MS,
  ) {
    this.flow = new TermFlow({
      forward: (stream, data) => this.send(pushEvent("term.data", { stream, data })),
      reset: (stream, replay) => this.send(pushEvent("term.reset", { stream, replay })),
      peek: (stream) => this.pty.request<PtyPeekResult>("pty.peek", { key: stream, preamble: true }),
    })
    this.offs = [
      pty.on("pty.data", (frame) => {
        // Host-pushed frame; pty-protocol.ts owns its shape.
        const { key, data, offset } = frame.payload as PtyDataEventPayload
        if (this.attached.has(key)) this.flow.data(key, data, offset)
      }),
      pty.on("pty.exit", (frame) => {
        const { key, code } = frame.payload as PtyExitEventPayload
        if (this.attached.has(key)) this.send(pushEvent("term.exit", { stream: key, code: code ?? null }))
      }),
      pty.on("pty.size", (frame) => {
        const { key, cols, rows } = frame.payload as PtySizeEventPayload
        // This host pushes: polling is only for one that doesn't.
        this.stopPolling()
        if (this.attached.has(key)) this.send(pushEvent("term.size", { stream: key, cols, rows }))
      }),
    ]
  }

  /**
   * `leafId` = a split pane of the tab: its session is `<taskId>::<tabId>::<leafId>`.
   * `acks`: the page sends `term.ack` for what it parsed, so the stream is flow-controlled (terminal-flow.ts).
   */
  async attach(
    taskId: string,
    tabId: string,
    cwd: string,
    size?: { cols: number; rows: number },
    leafId?: string,
    acks = false,
  ): Promise<AttachResult> {
    const stream = leafId ? `${taskId}::${tabId}::${leafId}` : `${taskId}::${tabId}`
    // No PTY host process holds no sessions: the tab is not live, and reviving it starts the host.
    const { sessions } = await this.pty
      .request<{ sessions: readonly PtySessionInfo[] }>("pty.list")
      .catch((err: unknown) => {
        const code = err instanceof Error && "code" in err ? String(err.code) : ""
        if (code === "ENOENT" || code === "ECONNREFUSED") return { sessions: [] }
        throw err
      })
    const session = sessions.find((s) => s.key === stream)
    if (!session) throw new BridgeError("TAB_NOT_LIVE", `tab ${tabId} has no hosted session`)
    if (!session.alive && session.restored) {
      // `pty.open` would RESPAWN a freeze-restored tab; the phone only looks.
      const peek = await this.pty.request<PtyPeekResult>("pty.peek", { key: stream })
      return { stream, alive: false, restored: true, replay: peek.data }
    }
    // The sink is registered before the replay is cut (synchronously, host
    // side), so live `pty.data` after this response never overlaps the replay.
    this.attached.add(stream)
    if (acks) this.flow.watch(stream)
    try {
      const open = await this.pty.request<PtyOpenResult>("pty.open", {
        key: stream,
        cwd,
        ...(size ? { cols: size.cols, rows: size.rows } : {}),
      })
      if (open.cols !== undefined)
        return { stream, alive: open.alive, replay: open.replay, cols: open.cols, rows: open.rows }
      // A host predating `cols`/`rows` on open pushes no `pty.size` either; a peek still reports the size.
      const peek = await this.pty.request<PtyPeekResult>("pty.peek", { key: stream, sinceOffset: open.offset })
      if (!size && this.attached.has(stream)) this.poll(stream, peek)
      return { stream, alive: open.alive, replay: open.replay, cols: peek.cols, rows: peek.rows }
    } catch (err) {
      this.attached.delete(stream)
      this.flow.forget(stream)
      throw err
    }
  }

  async input(stream: string, data: string): Promise<void> {
    this.requireAttached(stream)
    await this.pty.request("pty.write", { key: stream, data })
  }

  async resize(stream: string, cols: number, rows: number): Promise<void> {
    this.requireAttached(stream)
    await this.pty.request("pty.resize", { key: stream, cols, rows })
  }

  /** The page parsed `chars` more base64 chars of this stream's output. */
  ack(stream: string, chars: number): void {
    this.flow.ack(stream, chars)
  }

  async detach(stream: string): Promise<void> {
    if (!this.attached.delete(stream)) return
    this.polled.delete(stream)
    this.flow.forget(stream)
    await this.pty.request("pty.detach", { key: stream })
  }

  dispose(): void {
    for (const off of this.offs) off()
    for (const stream of this.attached) this.flow.forget(stream)
    this.attached.clear()
    this.stopPolling()
    // Closing the socket detaches every key this connection held.
    this.pty.close()
  }

  private poll(stream: string, seen: PtyPeekResult): void {
    this.polled.set(stream, { cols: seen.cols, rows: seen.rows, offset: seen.offset })
    this.pollTimer ??= setInterval(() => void this.pollSizes(), this.pollMs)
  }

  private stopPolling(): void {
    this.polled.clear()
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  private async pollSizes(): Promise<void> {
    for (const [stream, last] of this.polled) {
      // Cut at the last offset, so a peek carries only what was written since, not the whole ring.
      const peek = await this.pty
        .request<PtyPeekResult>("pty.peek", { key: stream, sinceOffset: last.offset })
        .catch(() => null)
      if (!peek || this.polled.get(stream) !== last) continue
      this.polled.set(stream, { cols: peek.cols, rows: peek.rows, offset: peek.offset })
      if (peek.cols && peek.rows && (peek.cols !== last.cols || peek.rows !== last.rows))
        this.send(pushEvent("term.size", { stream, cols: peek.cols, rows: peek.rows }))
    }
  }

  /** A phone may only type into a session it attached through this bridge. */
  private requireAttached(stream: string): void {
    if (!this.attached.has(stream)) throw new BridgeError("NOT_ATTACHED", `not attached to ${stream}`)
  }
}
