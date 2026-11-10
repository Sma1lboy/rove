import { describe, expect, it } from "vitest"
import { type Recording, recordStroke } from "../../src/tui/lib/chord-recorder"

const start = (slots = 1): Recording => ({ id: "x", slots, got: [], prefixArmed: false })
const PREFIX = ["ctrl+a"]

describe("recordStroke", () => {
  it("records a direct chord", () => {
    expect(recordStroke(start(), ["ctrl+g"], PREFIX)).toEqual({ kind: "done", mode: "direct", keys: ["ctrl+g"] })
  })

  it("records the stroke after the prefix key as a prefix binding", () => {
    const armed = recordStroke(start(), ["ctrl+a"], PREFIX)
    if (armed.kind !== "more") throw new Error("expected the recorder to wait for the second stroke")
    expect(recordStroke(armed.recording, ["shift+p", "p"], PREFIX)).toEqual({
      kind: "done",
      mode: "prefix",
      keys: ["shift+p"],
    })
  })

  it("collects every slot of a paired binding before finishing", () => {
    const first = recordStroke(start(2), ["w"], PREFIX)
    if (first.kind !== "more") throw new Error("expected a second slot")
    expect(recordStroke(first.recording, ["s"], PREFIX)).toEqual({ kind: "done", mode: "direct", keys: ["w", "s"] })
  })

  it("cancels on escape and spells the enter key one way", () => {
    expect(recordStroke(start(), ["escape"], PREFIX)).toEqual({ kind: "cancel" })
    expect(recordStroke(start(), ["return", "enter"], PREFIX)).toMatchObject({ keys: ["enter"] })
  })
})
