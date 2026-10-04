/**
 * The Sidebar re-renders only when a poll lands a changed value, so the change
 * signal is the contract: an equal result must stay silent or the idle tree
 * repaints every tick again.
 */

import { describe, expect, test, vi } from "vitest"
import { createBackgroundPoller, subscribeBackgroundPolls } from "../../src/tui/lib/background-poll"

describe("subscribeBackgroundPolls", () => {
  test("fires on a changed value and stays silent on an equal one", async () => {
    let next = "main"
    let runs = 0
    const poller = createBackgroundPoller<string>({
      run: async () => {
        runs++
        return next
      },
      timeoutMs: 1_000,
      slowRetryMs: 1_000,
      minIntervalMs: 0,
      initial: "",
    })
    let changes = 0
    const off = subscribeBackgroundPolls(() => changes++)
    // The cadence floor can drop a poll, so re-poll until one more run has landed.
    const pollOnce = async () => {
      const target = runs + 1
      await vi.waitFor(async () => {
        poller.poll("/repo")
        await new Promise((resolve) => setTimeout(resolve, 5))
        expect(runs).toBeGreaterThanOrEqual(target)
      })
    }
    try {
      await pollOnce()
      expect(poller.read("/repo")).toBe("main")
      expect(changes).toBe(1)

      await pollOnce()
      expect(changes).toBe(1)

      next = "feature"
      await pollOnce()
      expect(poller.read("/repo")).toBe("feature")
      expect(changes).toBe(2)
    } finally {
      off()
    }
  })
})
