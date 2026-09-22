import { DaemonEventBus } from "@sma1lboy/kobe-daemon/daemon/event-bus"
import { describe, expect, it } from "vitest"

describe("DaemonEventBus", () => {
  it("caches the LAST value per channel for late-subscriber replay", () => {
    const bus = new DaemonEventBus()
    bus.publish("active-task", { taskId: "t1" })
    bus.publish("active-task", { taskId: "t2" }) // newer wins
    bus.publish("task.snapshot", { tasks: [] })
    const snap = bus.snapshot()
    // one entry per channel, holding the most recent payload
    expect(snap).toContainEqual({ channel: "active-task", payload: { taskId: "t2" } })
    expect(snap).toContainEqual({ channel: "task.snapshot", payload: { tasks: [] } })
    expect(snap.filter((e) => e.channel === "active-task")).toHaveLength(1)
  })

  it("stops delivering to a sink after it unsubscribes", () => {
    const bus = new DaemonEventBus()
    const got: unknown[] = []
    const off = bus.onPublish((e) => got.push(e))
    bus.publish("active-task", { taskId: "t1" })
    off()
    bus.publish("active-task", { taskId: "t2" })
    expect(got).toEqual([{ channel: "active-task", payload: { taskId: "t1" } }])
  })
})
