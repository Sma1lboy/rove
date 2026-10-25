import { describe, expect, test } from "bun:test"
import type { DispatchRow } from "rove-bridge/protocol"
import { graphOf, pointOn } from "../src/dispatch-graph.ts"
import { TRAVEL_MS, moving, onMap, runnerOf } from "../src/dispatch.ts"

const row = (over: Partial<DispatchRow> = {}): DispatchRow => ({
  id: "x-1",
  kind: "send",
  from: { taskId: "main", tabId: "tab-1" },
  to: { taskId: "w", tabId: "tab-1" },
  promptHead: "fix it",
  at: 1_000,
  status: "delivered",
  statusAt: 1_000,
  ...over,
})

describe("dispatch courier", () => {
  test("runs its wire after the paste, knocks until the target's engine starts, then works there", () => {
    const halfway = runnerOf(row(), 1_000 + TRAVEL_MS / 2, 0)
    expect(halfway.pose).toBe("run")
    expect(halfway.x).toBeCloseTo(0.5)
    expect(runnerOf(row(), 1_000 + TRAVEL_MS * 3, 0)).toMatchObject({ pose: "knock", x: 1 })
    expect(runnerOf(row({ status: "working" }), 1_001, 0)).toMatchObject({ pose: "work", x: 1 })
  })

  test("a failed courier falls where the failure caught it, and leaves the map after a while", () => {
    const failed = row({ status: "failed" })
    expect(runnerOf(failed, 9_999, 0)).toMatchObject({ pose: "failed", x: 0 })
    expect(onMap(failed, 5_000)).toBe(true)
    expect(onMap(failed, 60_000)).toBe(false)
    expect(moving([failed], 60_000)).toBe(false)
  })
})

describe("dispatch network", () => {
  test("one node per sender and per target, in order of first dispatch; the owner and routines are senders", () => {
    const graph = graphOf([
      row({ id: "a", from: null }),
      row({ id: "b", from: null, routine: "nightly", to: { taskId: "w", tabId: "tab-2" } }),
      row({ id: "c" }),
      row({ id: "d", from: null }),
    ])
    expect(graph.senders.map((n) => n.key)).toEqual(["you", "routine:nightly", "main::tab-1"])
    expect(graph.targets.map((n) => n.key)).toEqual(["w::tab-1", "w::tab-2"])
  })

  test("a courier at the halfway point stands at the hub", () => {
    const wire = { from: { x: 0, y: 0 }, hubIn: { x: 90, y: 50 }, hubOut: { x: 110, y: 50 }, to: { x: 200, y: 100 } }
    expect(pointOn(wire, 0)).toEqual({ x: 0, y: 0 })
    expect(pointOn(wire, 0.5)).toEqual({ x: 110, y: 50 })
    expect(pointOn(wire, 1)).toEqual({ x: 200, y: 100 })
  })
})
