/**
 * The Sidebar re-renders only when a poll lands a changed value, so the change
 * signal is the contract: an equal result must stay silent or the idle tree
 * repaints every tick again.
 */

import { afterEach, describe, expect, test, vi } from "vitest"
import { createBackgroundPoller, subscribeBackgroundPolls } from "../../src/tui/lib/background-poll"

describe("subscribeBackgroundPolls", () => {
  // A frozen clock makes each run's duration 0, so the cadence floor never drops a poll.
  afterEach(() => {
    vi.useRealTimers()
  })

  test("fires on a changed value and stays silent on an equal one", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
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
    const pollOnce = async () => {
      poller.poll("/repo")
      await new Promise((resolve) => setImmediate(resolve))
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
      expect(runs).toBe(3)
    } finally {
      off()
    }
  })
})
