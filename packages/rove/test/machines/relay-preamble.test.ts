import { describe, expect, test } from "vitest"
import { PreambleStripper, RELAY_PREAMBLE } from "../../src/machines/relay-preamble.ts"

describe("the relay preamble", () => {
  test("drops a shell's output before it, even when the marker spans chunks", () => {
    const stripper = new PreambleStripper()
    const stream = Buffer.from(`\u001b[16A fastfetch {"not":"protocol"}\r\n${RELAY_PREAMBLE}{"id":1}`)
    const out: Buffer[] = []
    for (let i = 0; i < stream.length; i += 5) {
      const piece = stripper.push(stream.subarray(i, i + 5))
      if (piece) out.push(piece)
    }
    expect(Buffer.concat(out).toString()).toBe('{"id":1}')
    // After the marker, bytes pass untouched — including another marker.
    expect(stripper.push(Buffer.from(RELAY_PREAMBLE))?.toString()).toBe(RELAY_PREAMBLE)
  })

  test("gives up on a shell that never lets rove start", () => {
    const stripper = new PreambleStripper()
    const chunk = Buffer.alloc(256 * 1024, "x")
    const results = [1, 2, 3, 4, 5].map(() => stripper.push(chunk))
    expect(results.at(-1)).toBeNull()
  })
})
