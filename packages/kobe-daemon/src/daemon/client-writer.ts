/** Per-connection FIFO with bounded backpressure and explicit snapshot replacement. */
export interface BackpressureSocket {
  destroy(): void
  write(data: string): boolean
  once(event: "drain", listener: () => void): void
}

export interface ClientWriterOptions {
  readonly highWaterMark?: number
  /** Observe overflow and disconnect. Defaults to socket.destroy(). */
  readonly onOverflow?: () => void
}

export const DEFAULT_WRITE_HIGH_WATER_MARK = 8 * 1024 * 1024

interface QueuedFrame {
  readonly line: string
  readonly bytes: number
  readonly replaceKey: string | null
}

export class ClientWriter {
  private readonly highWaterMark: number
  private readonly onOverflow: () => void
  private readonly queue = new Map<number, QueuedFrame>()
  private readonly snapshots = new Map<string, number>()
  private sequence = 0
  private queuedBytes = 0
  private paused = false
  private droppedFrames = 0
  private overflowed = false

  constructor(
    private readonly socket: BackpressureSocket,
    options: ClientWriterOptions = {},
  ) {
    this.highWaterMark = options.highWaterMark ?? DEFAULT_WRITE_HIGH_WATER_MARK
    this.onOverflow = options.onOverflow ?? (() => socket.destroy())
  }

  get isPaused(): boolean {
    return this.paused
  }
  get pendingBytes(): number {
    return this.queuedBytes
  }
  get pendingCount(): number {
    return this.queue.size
  }
  /** Superseded snapshots, never arbitrary events. */
  get dropped(): number {
    return this.droppedFrames
  }

  /** Only complete, independently replaceable state gets a key. All other
   * frames use null and retain their order, including RPC and PTY bytes. */
  write(line: string, replaceKey: string | null = null): void {
    if (this.overflowed) return
    if (!this.paused) {
      if (!this.safeWrite(line)) this.pause()
      return
    }
    if (replaceKey !== null) {
      const previous = this.snapshots.get(replaceKey)
      if (previous !== undefined) {
        this.dequeue(previous)
        this.droppedFrames++
      }
    }
    const id = this.sequence++
    const frame = { line, bytes: Buffer.byteLength(line), replaceKey }
    this.queue.set(id, frame)
    if (replaceKey !== null) this.snapshots.set(replaceKey, id)
    this.queuedBytes += frame.bytes
    if (this.queuedBytes <= this.highWaterMark) return
    // A latest snapshot cannot be discarded: there may never be another publish.
    this.overflowed = true
    this.queue.clear()
    this.snapshots.clear()
    this.queuedBytes = 0
    this.onOverflow()
  }

  private dequeue(id: number): void {
    const frame = this.queue.get(id)
    if (!frame) return
    this.queue.delete(id)
    this.queuedBytes -= frame.bytes
    if (frame.replaceKey !== null) this.snapshots.delete(frame.replaceKey)
  }

  private pause(): void {
    this.paused = true
    this.socket.once("drain", () => {
      this.paused = false
      if (this.overflowed) return
      for (const [id, frame] of this.queue) {
        this.dequeue(id)
        if (!this.safeWrite(frame.line)) {
          this.pause()
          return
        }
      }
    })
  }

  private safeWrite(line: string): boolean {
    try {
      return this.socket.write(line)
    } catch {
      return true
    }
  }
}
