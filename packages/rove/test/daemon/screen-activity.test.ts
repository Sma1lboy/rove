import { DaemonActivityRegistry } from "@sma1lboy/rove-daemon/daemon/activity-registry"
import { DaemonEventBus } from "@sma1lboy/rove-daemon/daemon/event-bus"
import { describe, expect, it } from "vitest"
import { startTurnStatusPoll } from "../../src/tui/ops/activity-monitor"
import { bootDaemonHarness, fakeOrchestrator } from "./harness"

describe("attached screen approval", () => {
  it("publishes a blocked-only plugin screen to activity and inbox, then clears on an unmatched screen", async () => {
    const h = await bootDaemonHarness({ orchestrator: fakeOrchestrator({ getTask: () => ({ id: "task" }) }) })
    const client = h.client()
    let pane = "Allow command?"
    const states: string[] = []
    client.onChannel("engine-state", (value) => {
      if (value.tabId === "tab-1") states.push(value.state)
    })
    await client.subscribe()
    function waitForInbox(blocked: boolean): Promise<void> {
      return new Promise((resolve) => {
        const off = client.onChannel("attention.inbox", ({ items }) => {
          const needsInput = items.some((item) => item.taskId === "task" && item.state === "permission_needed")
          if (needsInput !== blocked) return
          off()
          resolve()
        })
      })
    }
    const blocked = waitForInbox(true)
    const stop = startTurnStatusPoll(
      {
        detector: { supportsCompletionMarkers: () => false, latestActivityInFile: async () => null },
        session: () => null,
        screenManifest: { rules: [{ state: "blocked", all: ["Allow command?"] }] },
      },
      {
        sessionAttached: async () => true,
        capturePane: async () => pane,
        setTurnState: async () => {},
        setScreenBlocked: async (blocked) => {
          await client.request("engine.reportEvent", { source: "screen", taskId: "task", tabId: "tab-1", blocked })
        },
      },
    )
    try {
      // Activity broadcasts precede inbox persistence; the inbox event confirms both are ready.
      await blocked
      expect(states.at(-1)).toBe("permission_needed")
      expect(await client.request("attention.list", {})).toMatchObject({
        items: [{ taskId: "task", state: "permission_needed" }],
      })
      const cleared = waitForInbox(false)
      pane = "Approved. Working..."
      await cleared
      expect(states.at(-1)).toBe("idle")
      expect(await client.request("attention.list", {})).toMatchObject({ items: [] })
      await expect(
        client.request("engine.reportEvent", { source: "screen", taskId: "task", tabId: "tab-1", blocked: "yes" }),
      ).rejects.toThrow("boolean")
    } finally {
      stop()
      await h.close()
    }
  })

  it("keeps observations current behind a screen claim and leaves hook claims untouched", () => {
    const registry = new DaemonActivityRegistry(new DaemonEventBus())
    try {
      registry.observeTab("task", "tab", "rest")
      expect(registry.reportScreen("task", "tab", true)).toBe(true)
      registry.observeTab("task", "tab", "working")
      expect(registry.debugSnapshot().tabs.task?.tab).toMatchObject({ state: "permission_needed", source: "screen" })
      expect(registry.reportScreen("task", "tab", true)).toBe(false)
      registry.reportScreen("task", "tab", false)
      expect(registry.debugSnapshot().tabs.task?.tab).toMatchObject({ state: "running", source: "observed" })
      registry.observeTab("task", "tab", "rest")
      expect(registry.debugSnapshot().tabs.task?.tab.state).toBe("idle")
      for (const kind of ["turn-start", "awaiting-input", "turn-complete"] as const) {
        registry.report("task", kind, undefined, "tab", undefined, "claude")
        const before = registry.debugSnapshot()
        expect(registry.reportScreen("task", "tab", true)).toBe(false)
        expect(registry.reportScreen("task", "tab", false)).toBe(false)
        expect(registry.debugSnapshot()).toEqual(before)
      }
    } finally {
      registry.close()
    }
  })
})
