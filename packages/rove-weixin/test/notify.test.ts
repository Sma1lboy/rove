import { describe, expect, it } from "bun:test"
import type { Gate } from "@sma1lboy/rove-daemon/daemon/contracts"
import { GateTracker } from "../src/notify.ts"

const gate = (id: string): Gate => ({ id, status: "open" }) as Gate

describe("GateTracker", () => {
  it("does not re-announce a standing decision after a failed gate read", () => {
    const tracker = new GateTracker()
    expect(tracker.observe([gate("g-1")])).toEqual([])
    expect(tracker.observe(null)).toEqual([])
    expect(tracker.observe([gate("g-1")])).toEqual([])
    expect(tracker.observe([gate("g-1"), gate("g-2")]).map((g) => g.id)).toEqual(["g-2"])
  })
})
