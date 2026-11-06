import { describe, expect, test } from "bun:test"
import type { DispatchRow } from "rove-bridge/protocol"
import { graphOf, pointOn } from "../src/dispatch-graph.ts"
import { TRAVEL_MS, flightOf, moving, statusByTarget, stoppedAt } from "../src/dispatch.ts"

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

describe("dispatch prompts", () => {
  test("a prompt rides its wire after the paste and is gone from it on arrival", () => {
    expect(flightOf(row(), 1_000 + TRAVEL_MS / 2)).toBeCloseTo(0.5)
    expect(flightOf(row(), 1_000 + TRAVEL_MS * 3)).toBeNull()
    expect(flightOf(row({ status: "working" }), 1_001)).toBeNull()
    expect(moving([row()], 1_000 + TRAVEL_MS * 3)).toBe(false)
  })

  test("a prompt that failed before it arrived stops where the failure caught it; one that failed at the target does not", () => {
    expect(stoppedAt(row({ status: "failed" }))).toBe(0)
    expect(stoppedAt(row({ status: "failed", statusAt: 1_000 + TRAVEL_MS / 2 }))).toBeCloseTo(0.5)
    expect(stoppedAt(row({ status: "failed", statusAt: 1_000 + TRAVEL_MS * 3 }))).toBeNull()
    expect(stoppedAt(row())).toBeNull()
  })

  test("a target shows a question waiting for you over anything newer, and work under way over a stale delivery", () => {
    const key = (r: DispatchRow) => r.to.taskId
    expect(statusByTarget([row({ id: "a", status: "asking" }), row({ id: "b", status: "done" })], key).get("w")).toBe(
      "asking",
    )
    expect(
      statusByTarget([row({ id: "a", status: "working" }), row({ id: "b", status: "delivered" })], key).get("w"),
    ).toBe("working")
    expect(
      statusByTarget([row({ id: "a", status: "delivered" }), row({ id: "b", status: "done" })], key).get("w"),
    ).toBe("done")
    expect(
      statusByTarget([row({ id: "a", status: "failed" }), row({ id: "b", status: "working" })], key).get("w"),
    ).toBe("working")
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

  test("a prompt at the halfway point is at the hub", () => {
    const wire = { from: { x: 0, y: 0 }, hubIn: { x: 90, y: 50 }, hubOut: { x: 110, y: 50 }, to: { x: 200, y: 100 } }
    expect(pointOn(wire, 0)).toEqual({ x: 0, y: 0 })
    expect(pointOn(wire, 0.5)).toEqual({ x: 110, y: 50 })
    expect(pointOn(wire, 1)).toEqual({ x: 200, y: 100 })
  })
})
