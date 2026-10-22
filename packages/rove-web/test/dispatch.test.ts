import { describe, expect, test } from "bun:test"
import type { DispatchRow } from "rove-bridge/protocol"
import { TRAVEL_MS, lanes, moving, runnerOf } from "../src/dispatch.ts"

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
  test("runs the lane after the paste, then knocks until the target's engine starts, then works there", () => {
    expect(runnerOf(row(), 1_000 + TRAVEL_MS / 2, 0)).toMatchObject({ pose: "run", x: 0.5 })
    expect(runnerOf(row(), 1_000 + TRAVEL_MS * 3, 0)).toMatchObject({ pose: "knock", x: 1 })
    expect(runnerOf(row({ status: "working" }), 1_001, 0)).toMatchObject({ pose: "work", x: 1 })
  })

  test("a failed courier falls where the failure caught it", () => {
    expect(runnerOf(row({ status: "failed" }), 9_999, 0)).toMatchObject({ pose: "failed", x: 0 })
    expect(runnerOf(row({ status: "failed", statusAt: 1_000 + TRAVEL_MS }), 9_999, 0).x).toBe(1)
  })

  test("only a courier with frames left keeps the page ticking; settled rows leave the lanes", () => {
    const rows = [row({ id: "a", status: "asking" }), row({ id: "b", status: "done" })]
    expect(moving(rows)).toBe(false)
    expect(moving([...rows, row({ id: "c" })])).toBe(true)
    expect(lanes(rows)).toEqual({ open: [rows[0] as DispatchRow], done: [rows[1] as DispatchRow] })
  })
})
