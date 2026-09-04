/** Socket backpressure preserves ordered frames and replaces only superseded snapshots. */

import { ClientWriter } from "@sma1lboy/kobe-daemon/daemon/client-writer"
import { describe, expect, it } from "vitest"

/**
 * Fake socket whose `write` returns `accept` (set `false` to simulate a full
 * send buffer) and that captures `'drain'` listeners so a test can fire drain
 * deterministically. Records every line handed to the wire.
 */
class FakeSocket {
  writes: string[] = []
  accept = true
  destroyed = false
  destroy(): void {
    this.destroyed = true
  }
  private drainListeners: Array<() => void> = []

  write(data: string): boolean {
    this.writes.push(data)
    return this.accept
  }

  once(event: "drain", listener: () => void): void {
    if (event === "drain") this.drainListeners.push(listener)
  }

  emitDrain(): void {
    const listeners = this.drainListeners
    this.drainListeners = []
    for (const listener of listeners) listener()
  }
}

describe("ClientWriter backpressure", () => {
  it("pauses when write() returns false and resumes (in order) on drain", () => {
    const sock = new FakeSocket()
    const writer = new ClientWriter(sock)

    // Socket buffer is full: the first frame is accepted by the kernel but
    // write() reports false → the writer must pause.
    sock.accept = false
    writer.write("a\n", null)
    expect(sock.writes).toEqual(["a\n"])
    expect(writer.isPaused).toBe(true)

    // While paused, further frames are buffered, NOT handed to the socket.
    writer.write("b\n", null)
    writer.write("c\n", null)
    expect(sock.writes).toEqual(["a\n"])
    expect(writer.pendingCount).toBe(2)

    // Drain → flush the queue in order, then unpause.
    sock.accept = true
    sock.emitDrain()
    expect(sock.writes).toEqual(["a\n", "b\n", "c\n"])
    expect(writer.isPaused).toBe(false)
    expect(writer.pendingCount).toBe(0)
  })

  it("replaces only superseded snapshots and preserves lifecycle order", () => {
    const sock = new FakeSocket()
    const writer = new ClientWriter(sock, { highWaterMark: 12 })

    // Saturate the socket so subsequent frames queue.
    sock.accept = false
    writer.write("PAUSE", null)
    expect(writer.isPaused).toBe(true)

    // A newer snapshot replaces the same channel while the lifecycle frame stays queued.
    writer.write("old01", "task.snapshot")
    writer.write("STOP!", null)
    writer.write("new02", "task.snapshot")
    expect(writer.dropped).toBe(1)
    expect(writer.pendingCount).toBe(2)

    sock.accept = true
    sock.emitDrain()

    // Surviving frames keep their original order.
    expect(sock.writes).toEqual(["PAUSE", "STOP!", "new02"])
    expect(sock.writes).toContain("STOP!")
    expect(sock.writes).not.toContain("old01")
  })

  it("bounds critical responses even without an overflow callback", () => {
    const sock = new FakeSocket()
    const writer = new ClientWriter(sock, { highWaterMark: 1024 })
    sock.accept = false
    writer.write("PAUSE", null)
    for (let i = 0; i < 100; i++) writer.write("x".repeat(1024), null)
    expect(sock.destroyed).toBe(true)
    expect(writer.pendingBytes).toBe(0)
    sock.emitDrain()
    expect(sock.writes).toEqual(["PAUSE"])
  })

  it("disconnects a critical-only slow stream instead of retaining an unbounded queue", () => {
    const sock = new FakeSocket()
    let overflows = 0
    const writer = new ClientWriter(sock, {
      highWaterMark: 4,
      onOverflow: () => overflows++,
    })

    sock.accept = false
    writer.write("PAUSE", null)
    writer.write("L1!!!", null)

    expect(overflows).toBe(1)
    expect(writer.pendingBytes).toBe(0)
    expect(writer.pendingCount).toBe(0)

    writer.write("L2!!!", null)
    expect(overflows).toBe(1)
    expect(writer.pendingCount).toBe(0)
  })

  it("re-pauses mid-flush if the socket saturates again, losing nothing", () => {
    const sock = new FakeSocket()
    const writer = new ClientWriter(sock)

    sock.accept = false
    writer.write("a\n", null) // pause
    writer.write("b\n", null)
    writer.write("c\n", null)

    // First drain: socket accepts exactly one more frame then saturates again.
    let served = 0
    const realWrite = sock.write.bind(sock)
    sock.write = (data: string): boolean => {
      realWrite(data)
      served++
      return served < 1 // only the first flushed frame is accepted
    }
    sock.emitDrain()
    expect(sock.writes).toEqual(["a\n", "b\n"]) // b flushed, then re-paused
    expect(writer.isPaused).toBe(true)
    expect(writer.pendingCount).toBe(1) // c still queued

    // Second drain with a healthy socket: c finally lands.
    sock.write = realWrite
    sock.accept = true
    sock.emitDrain()
    expect(sock.writes).toEqual(["a\n", "b\n", "c\n"])
    expect(writer.isPaused).toBe(false)
  })

  it("does not crash if the socket throws on write", () => {
    const sock = new FakeSocket()
    const writer = new ClientWriter(sock)
    sock.write = () => {
      throw new Error("EPIPE: socket destroyed")
    }
    expect(() => writer.write("a\n", null)).not.toThrow()
    // Swallowed write is treated as accepted → no pause, no queue leak.
    expect(writer.isPaused).toBe(false)
    expect(writer.pendingCount).toBe(0)
  })
})
