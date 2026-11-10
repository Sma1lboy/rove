/** The dispatch ledger keeps each handed-over prompt's progress, moved by the target's own engine reports. */

import { DispatchLedger, type DispatchSnapshot } from "@sma1lboy/rove-daemon/daemon/dispatch-ledger"
import { DaemonEventBus } from "@sma1lboy/rove-daemon/daemon/event-bus"
import { afterEach, describe, expect, it, vi } from "vitest"

function setup(now = 1_000) {
  const bus = new DaemonEventBus()
  const clock = { now }
  const ledger = new DispatchLedger(bus, () => clock.now)
  const engine = (taskId: string, tabId: string, state: string, at: number) =>
    bus.publish("engine-state", { taskId, tabId, state, at } as never)
  const published = () => bus.snapshot().find((e) => e.channel === "dispatch.snapshot")?.payload as DispatchSnapshot
  return { ledger, engine, published }
}

const send = { kind: "send" as const, from: { taskId: "main", tabId: "tab-1" }, promptHead: "fix the build" }

describe("dispatch ledger", () => {
  it("walks delivered → working → asking → working → done on the target tab, and publishes each step", () => {
    const { ledger, engine, published } = setup()
    ledger.record({ ...send, to: { taskId: "w", tabId: "tab-1" }, delivered: true })
    // A turn that ended before ours started belongs to the prompt the engine was still on.
    engine("w", "tab-1", "turn_complete", 1_001)
    expect(published().rows[0]?.status).toBe("delivered")
    engine("w", "tab-2", "running", 1_002)
    expect(published().rows[0]?.status).toBe("delivered")
    const steps: string[] = []
    for (const [state, at] of [
      ["running", 1_003],
      ["permission_needed", 1_004],
      ["running", 1_005],
      ["turn_complete", 1_006],
      ["running", 1_007],
    ] as const) {
      engine("w", "tab-1", state, at)
      steps.push(published().rows[0]?.status ?? "")
    }
    expect(steps).toEqual(["working", "asking", "working", "done", "done"])
  })

  it("a send with no known tab takes the first tab its task reports from", () => {
    const { ledger, engine, published } = setup()
    ledger.record({ ...send, to: { taskId: "w", tabId: null }, delivered: true })
    engine("w", "tab-3", "running", 1_001)
    expect(published().rows[0]).toMatchObject({ status: "working", to: { taskId: "w", tabId: "tab-3" } })
  })

  it("a paste that did not land is failed at once; a dead engine fails an in-flight one", () => {
    const { ledger, engine, published } = setup()
    ledger.record({ ...send, to: { taskId: "a", tabId: "tab-1" }, delivered: false, reason: "no-session" })
    ledger.record({ ...send, to: { taskId: "b", tabId: "tab-1" }, delivered: true })
    engine("b", "tab-1", "dead", 1_001)
    expect(published().rows.map((r) => [r.status, r.reason])).toEqual([
      ["failed", "no-session"],
      ["failed", "dead"],
    ])
  })

  it("a send to another machine's task moves on the hub's relayed readings of it", () => {
    const bus = new DaemonEventBus()
    const ledger = new DispatchLedger(bus, () => 1_000)
    const relay = (activity: Record<string, { state: string; at: number }>) =>
      bus.publish("machines", { machines: [], tasks: [], live: { activity } } as never)
    ledger.record({ ...send, to: { taskId: "far", tabId: "tab-1" }, delivered: true })
    // The relay republishes the last reading on every push; one from before the send moves nothing.
    relay({ far: { state: "turn_complete", at: 999 } })
    expect(ledger.list().rows[0]?.status).toBe("delivered")
    relay({ far: { state: "running", at: 1_001 } })
    expect(ledger.list().rows[0]?.status).toBe("working")
    // An idle task is dropped from the relay rather than reported idle.
    relay({})
    expect(ledger.list().rows[0]?.status).toBe("done")
  })

  describe("an in-flight row nothing moves", () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it("leaves the published snapshot after six hours even when nothing else changes", () => {
      vi.useFakeTimers({ now: 1_000 })
      const bus = new DaemonEventBus()
      const ledger = new DispatchLedger(bus)
      const published = () => bus.snapshot().find((e) => e.channel === "dispatch.snapshot")?.payload as DispatchSnapshot
      ledger.record({ ...send, to: { taskId: "w", tabId: "tab-1" }, delivered: true })
      ledger.record({ ...send, to: { taskId: "x", tabId: "tab-1" }, delivered: false, reason: "no-session" })

      vi.advanceTimersByTime(6 * 60 * 60_000 - 1)
      expect(published().rows.map((r) => r.status)).toEqual(["delivered", "failed"])
      vi.advanceTimersByTime(1)
      expect(published().rows.map((r) => r.status)).toEqual(["failed"])
      expect(ledger.list().rows).toEqual(published().rows)
      ledger.close()
    })
  })
})
