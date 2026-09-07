import { DaemonActivityRegistry } from "@sma1lboy/kobe-daemon/daemon/activity-registry"
import { DaemonEventBus } from "@sma1lboy/kobe-daemon/daemon/event-bus"
import { describe, expect, it } from "vitest"

describe("task rollup ownership", () => {
  it.each([undefined, { id: "b", transcriptPath: "/a" }])("does not clear a sibling whose session is %j", (sibling) => {
    let now = 1
    const registry = new DaemonActivityRegistry(new DaemonEventBus(), 1000, () => now)
    try {
      registry.report("t", "turn-start", undefined, "tab-1", { id: "a", transcriptPath: "/a" }, "claude")
      now = 2
      registry.report("t", "turn-start", undefined, "tab-2", sibling, "codex")
      now = 3
      registry.recordEngineDeath("t", "tab-1", { code: 1 }, now)
      expect(registry.snapshotByTask().t).toMatchObject({ state: "running", at: 2 })
      registry.observeTab("t", "tab-1", "rest", { correctHookRunningAfterMs: 0 })
      expect(registry.snapshotByTask().t).toMatchObject({ state: "running", at: 2 })
      registry.recordEngineDeath("t", "tab-2", { code: 1 }, now)
      expect(registry.snapshotByTask().t.state).toBe("idle")
    } finally {
      registry.close()
    }
  })

  it("does not let a historical death clear a replacement session in the same tab", () => {
    let now = 1
    const registry = new DaemonActivityRegistry(new DaemonEventBus(), 1000, () => now)
    try {
      registry.report("t", "turn-start", undefined, "tab-1", { id: "old", transcriptPath: "/same" })
      now = 3
      registry.report("t", "turn-start", undefined, "tab-1", { id: "new", transcriptPath: "/same" })
      registry.recordEngineDeath("t", "tab-1", { code: 1 }, 2)
      expect(registry.snapshotByTask().t).toMatchObject({ state: "running", sessionId: "new" })
    } finally {
      registry.close()
    }
  })
})
