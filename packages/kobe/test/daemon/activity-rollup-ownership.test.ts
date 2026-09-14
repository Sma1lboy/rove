import { DaemonActivityRegistry } from "@sma1lboy/kobe-daemon/daemon/activity-registry"
import { DaemonEventBus } from "@sma1lboy/kobe-daemon/daemon/event-bus"
import { describe, expect, it } from "vitest"

/** The derived task-level rollup, as every production consumer reads it. */
function rollup(registry: DaemonActivityRegistry) {
  return registry.replaySnapshot().find((payload) => !payload.tabId)
}

describe("derived task rollup", () => {
  it.each([undefined, { id: "b", transcriptPath: "/a" }])("does not clear a sibling whose session is %j", (sibling) => {
    let now = 1
    const registry = new DaemonActivityRegistry(new DaemonEventBus(), 1000, () => now)
    try {
      registry.report("t", "turn-start", undefined, "tab-1", { id: "a", transcriptPath: "/a" }, "claude")
      now = 2
      registry.report("t", "turn-start", undefined, "tab-2", sibling, "codex")
      now = 3
      registry.recordEngineDeath("t", "tab-1", { code: 1 }, now)
      expect(rollup(registry)).toMatchObject({ state: "running", at: 2 })
      registry.observeTab("t", "tab-1", "rest", { correctHookRunningAfterMs: 0 })
      expect(rollup(registry)).toMatchObject({ state: "running", at: 2 })
      registry.recordEngineDeath("t", "tab-2", { code: 1 }, now)
      // Both engines are gone — the task reports the DEATH, not idle. A dead
      // engine and a task nobody ever ran are different things to look at.
      expect(rollup(registry)).toMatchObject({ state: "dead" })
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
      expect(rollup(registry)).toMatchObject({ state: "running", sessionId: "new" })
    } finally {
      registry.close()
    }
  })

  it("prefers a running tab over a completed one, whichever reported last", () => {
    let now = 1
    const registry = new DaemonActivityRegistry(new DaemonEventBus(), 1000, () => now)
    try {
      registry.report("t", "turn-start", undefined, "tab-1")
      now = 2
      registry.report("t", "turn-start", undefined, "tab-2")
      now = 3
      registry.report("t", "turn-complete", undefined, "tab-1")
      // tab-1 finished LAST; tab-2 is still working, so the task is working.
      expect(rollup(registry)).toMatchObject({ state: "running", at: 2 })
      now = 4
      registry.report("t", "turn-complete", undefined, "tab-2")
      expect(rollup(registry)).toMatchObject({ state: "turn_complete", at: 4 })
    } finally {
      registry.close()
    }
  })

  it("drops a closed tab's claim from the rollup", () => {
    let now = 1
    const registry = new DaemonActivityRegistry(new DaemonEventBus(), 1000, () => now)
    try {
      registry.report("t", "turn-start", undefined, "tab-1")
      expect(rollup(registry)).toMatchObject({ state: "running" })
      now = 2
      registry.clearTab("t", "tab-1")
      expect(rollup(registry)).toBeUndefined()
      expect(registry.replaySnapshot()).toEqual([])
    } finally {
      registry.close()
    }
  })

  it("ignores an observation for a task that no longer exists", () => {
    const registry = new DaemonActivityRegistry(
      new DaemonEventBus(),
      1000,
      () => 1,
      () => Promise.resolve(undefined),
      (taskId) => taskId === "alive",
    )
    try {
      expect(registry.observeTab("gone", "tab-1", "working")).toBe("noop")
      expect(registry.replaySnapshot()).toEqual([])
      expect(registry.observeTab("alive", "tab-1", "working")).toBe("observed-running")
    } finally {
      registry.close()
    }
  })
})
