/**
 * The page's side of the bridge's terminal frames: decoding `term.*` pushes, and flow control
 * (rove-bridge terminal-flow.ts): report the output xterm has parsed, so the bridge keeps at most
 * ~1 MB in flight and Ctrl+C on a flood shows at once.
 */

export function decode(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

export function streamPayload(data: unknown): { stream: string; data?: string; code?: number | null } | null {
  if (!data || typeof data !== "object" || !("stream" in data) || typeof data.stream !== "string") return null
  return {
    stream: data.stream,
    ...("data" in data && typeof data.data === "string" ? { data: data.data } : {}),
    ...("code" in data && (typeof data.code === "number" || data.code === null) ? { code: data.code } : {}),
  }
}

const ACK_BATCH_CHARS = 64 * 1024
/** A quiet stream still acks its tail; the bridge resyncs only once everything sent is acked. */
const ACK_IDLE_MS = 20

export interface TermAcks {
  /** xterm finished parsing `chars` base64 chars of this stream's output. */
  parsed(chars: number): void
  dispose(): void
}

export function createAcks(send: (chars: number) => void): TermAcks {
  let pending = 0
  let timer: number | null = null
  const flush = () => {
    if (timer !== null) window.clearTimeout(timer)
    timer = null
    if (pending > 0) send(pending)
    pending = 0
  }
  return {
    parsed(chars) {
      pending += chars
      if (pending >= ACK_BATCH_CHARS) flush()
      else timer ??= window.setTimeout(flush, ACK_IDLE_MS)
    },
    dispose() {
      if (timer !== null) window.clearTimeout(timer)
      timer = null
      pending = 0
    },
  }
}

/** `term.reset`: the bridge dropped output the page fell behind on; the host ring replaces the screen. */
export function resetPayload(data: unknown): { stream: string; replay: string } | null {
  if (!data || typeof data !== "object" || !("stream" in data) || !("replay" in data)) return null
  return typeof data.stream === "string" && typeof data.replay === "string"
    ? { stream: data.stream, replay: data.replay }
    : null
}
