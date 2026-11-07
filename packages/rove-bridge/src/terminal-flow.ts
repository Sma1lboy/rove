/**
 * Flow control for a page that acks the terminal output it has parsed (`term.ack`).
 *
 * A browser parses a flood (`seq 1 50000000`) slower than the host produces it. Unbounded, tens
 * of megabytes queue between bridge and page, so Ctrl+C takes seconds to show, and Bun's socket
 * drops frames silently past its own backpressure limit. Here a stream with more than
 * FLOW_HIGH unacked chars stops getting live output; once the page has acked everything it is
 * resynced from the host's ring (`pty.peek`), which ends on the newest screen.
 */

/** Unacked base64 chars before live output stops (~730 KiB raw, ~130ms of browser parse). */
export const FLOW_HIGH = 1_000_000
/** A stream behind with no ack for this long resyncs anyway: a dropped frame would never be acked. */
const STALL_MS = 3000

export interface FlowIo {
  forward(stream: string, data: string): void
  /** Replace the page's screen with the ring (`term.reset`). */
  reset(stream: string, replay: string): void
  peek(stream: string): Promise<{ readonly offset: number; readonly data: string }>
}

interface FlowStream {
  unacked: number
  state: "live" | "behind" | "resync"
  /** Frames that arrived while the peek was in flight; those past its cut are still owed. */
  held: Array<{ readonly data: string; readonly offset: number }>
  stall: Timer | null
}

export class TermFlow {
  private readonly streams = new Map<string, FlowStream>()

  constructor(
    private readonly io: FlowIo,
    private readonly stallMs = STALL_MS,
  ) {}

  watch(stream: string): void {
    this.forget(stream)
    this.streams.set(stream, { unacked: 0, state: "live", held: [], stall: null })
  }

  forget(stream: string): void {
    const s = this.streams.get(stream)
    if (s) this.disarm(s)
    this.streams.delete(stream)
  }

  /** `offset` is the host's byte total after this chunk; a host too old to send it gets no flow control. */
  data(stream: string, data: string, offset: number | undefined): void {
    const s = this.streams.get(stream)
    if (!s || offset === undefined) {
      if (s) this.forget(stream)
      this.io.forward(stream, data)
      return
    }
    if (s.state === "resync") s.held.push({ data, offset })
    if (s.state !== "live") return
    this.send(stream, s, data)
  }

  ack(stream: string, chars: number): void {
    const s = this.streams.get(stream)
    if (!s) return
    s.unacked = Math.max(0, s.unacked - chars)
    if (s.state !== "behind") return
    // Resync once the page has drawn what it was sent, so Ctrl+C waits on at most FLOW_HIGH.
    if (s.unacked === 0) void this.resync(stream, s)
    else this.arm(stream, s)
  }

  private send(stream: string, s: FlowStream, data: string): void {
    this.io.forward(stream, data)
    s.unacked += data.length
    if (s.unacked <= FLOW_HIGH) return
    s.state = "behind"
    this.arm(stream, s)
  }

  private arm(stream: string, s: FlowStream): void {
    this.disarm(s)
    s.stall = setTimeout(() => {
      s.stall = null
      if (this.streams.get(stream) === s && s.state === "behind") void this.resync(stream, s)
    }, this.stallMs)
  }

  private disarm(s: FlowStream): void {
    if (s.stall !== null) clearTimeout(s.stall)
    s.stall = null
  }

  private async resync(stream: string, s: FlowStream): Promise<void> {
    this.disarm(s)
    s.state = "resync"
    s.held = []
    let ring: { readonly offset: number; readonly data: string } | null = null
    try {
      ring = await this.io.peek(stream)
    } catch {
      // No ring to repaint from: hand over what arrived meanwhile and carry on live.
    }
    if (this.streams.get(stream) !== s) return
    const held = s.held
    s.held = []
    s.state = "live"
    if (ring) {
      this.io.reset(stream, ring.data)
      s.unacked = ring.data.length
    }
    // Frames up to the peek's cut are already in the ring; the rest follow it.
    for (const frame of held) {
      if (s.state !== "live") break
      if (!ring || frame.offset > ring.offset) this.send(stream, s, frame.data)
    }
  }
}
