import { describe, expect, it } from "vitest"
import { LineReceiver, MAX_REQUEST_FRAME_BYTES } from "../../../rove-daemon/src/daemon/line-receiver.ts"

const BYTES = Buffer.from("任务🚀\nsecond\n\n尾巴")

describe("bounded request framing", () => {
  it.each(Array.from({ length: BYTES.length + 1 }, (_, split) => split))(
    "preserves UTF-8 when the chunk boundary falls at byte %i and drains multiple frames",
    (split) => {
      const receiver = new LineReceiver()
      const lines: string[] = []
      expect(receiver.push(BYTES.subarray(0, split), (line) => lines.push(line))).toBe(true)
      expect(receiver.push(BYTES.subarray(split), (line) => lines.push(line))).toBe(true)
      expect(lines).toEqual(["任务🚀", "second", ""])
      expect(receiver.pendingBytes).toBe(Buffer.byteLength("尾巴"))
      receiver.push(Buffer.from("\n"), (line) => lines.push(line))
      expect(lines.at(-1)).toBe("尾巴")
    },
  )
  it("accepts the exact byte limit, including many complete frames in one chunk", () => {
    const receiver = new LineReceiver(6)
    const lines: string[] = []
    expect(receiver.push(Buffer.from("任务\n123456\na\n"), (line) => lines.push(line))).toBe(true)
    expect(lines).toEqual(["任务", "123456", "a"])
  })
  it.each(["", "\nvalid\n"])("rejects an oversized frame ending %j without processing its suffix", (ending) => {
    const receiver = new LineReceiver(6)
    const lines: string[] = []
    expect(receiver.push(Buffer.from(`任务x${ending}`), (line) => lines.push(line))).toBe(false)
    expect(receiver.pendingBytes).toBe(0)
    expect(receiver.push(Buffer.from("valid\n"), (line) => lines.push(line))).toBe(false)
    expect(lines).toEqual([])
  })
  it("accepts a multi-megabyte prompt in small chunks and rejects 16MiB without a newline", () => {
    const receiver = new LineReceiver()
    const chunk = Buffer.alloc(1024, 120)
    const frames: string[] = []
    const accepted = Array.from({ length: MAX_REQUEST_FRAME_BYTES / chunk.length }, () =>
      receiver.push(chunk, (line) => frames.push(line)),
    )
    expect(accepted.every(Boolean)).toBe(true)
    expect(frames).toEqual([])
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
