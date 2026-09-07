import { describe, expect, it } from "vitest"
import { LineReceiver, MAX_REQUEST_FRAME_BYTES } from "../../../kobe-daemon/src/daemon/line-receiver.ts"

describe("bounded request framing", () => {
  it("preserves UTF-8 at every chunk boundary and drains multiple frames", () => {
    const bytes = Buffer.from("任务🚀\nsecond\n\n尾巴")
    for (let split = 0; split <= bytes.length; split++) {
      const receiver = new LineReceiver()
      const lines: string[] = []
      expect(receiver.push(bytes.subarray(0, split), (line) => lines.push(line))).toBe(true)
      expect(receiver.push(bytes.subarray(split), (line) => lines.push(line))).toBe(true)
      expect(lines).toEqual(["任务🚀", "second", ""])
      expect(receiver.pendingBytes).toBe(Buffer.byteLength("尾巴"))
      receiver.push(Buffer.from("\n"), (line) => lines.push(line))
      expect(lines.at(-1)).toBe("尾巴")
    }
  })
  it("accepts the exact byte limit, including many complete frames in one chunk", () => {
    const receiver = new LineReceiver(6)
    const lines: string[] = []
    expect(receiver.push(Buffer.from("任务\n123456\na\n"), (line) => lines.push(line))).toBe(true)
    expect(lines).toEqual(["任务", "123456", "a"])
  })
  it("rejects terminated and unterminated oversized frames without processing their suffix", () => {
    for (const ending of ["", "\nvalid\n"]) {
      const receiver = new LineReceiver(6)
      const lines: string[] = []
      expect(receiver.push(Buffer.from(`任务x${ending}`), (line) => lines.push(line))).toBe(false)
      expect(receiver.pendingBytes).toBe(0)
      expect(receiver.push(Buffer.from("valid\n"), (line) => lines.push(line))).toBe(false)
      expect(lines).toEqual([])
    }
  })
  it("accepts a multi-megabyte prompt in small chunks and rejects 16MiB without a newline", () => {
    const receiver = new LineReceiver()
    const chunk = Buffer.alloc(1024, 120)
    for (let i = 0; i < MAX_REQUEST_FRAME_BYTES / chunk.length; i++) {
      expect(
        receiver.push(chunk, () => {
          throw new Error("unexpected frame")
        }),
      ).toBe(true)
    }
    let length = 0
    expect(
      receiver.push(Buffer.from("\n"), (line) => {
        length = line.length
      }),
    ).toBe(true)
    expect(length).toBe(MAX_REQUEST_FRAME_BYTES)
    expect(receiver.push(Buffer.alloc(16 * 1024 * 1024), () => {})).toBe(false)
    expect(receiver.pendingBytes).toBe(0)
  })
})
