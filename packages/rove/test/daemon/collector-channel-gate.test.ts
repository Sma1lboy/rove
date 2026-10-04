/**
 * Per-channel collector gate — the collectors must be started by the
 * channels a client actually subscribed to, not by "someone is connected".
 *
 * `hasSubscribers()` ignored `client.channels`, so a pane subscribing to
 * `["ui-prefs", "keybindings"]` — exactly what the TUI's UiPrefsSync does —
 * opened every collector: measured at 194 `git` spawns in 8 seconds to
 * deliver the two frames it asked for, all of which were then dropped at
 * the socket by the publish-side filter. The gate is now
 * `hasSubscribersFor(channel)`, wired per collector in collectors.ts.
 *
 * Proven through the real socket with the worktree-changes collector, the
 * loudest of them: the runner is a counting double, so "the poller started"
 * is a number, not an inference.
 */

import { afterEach, describe, expect, it } from "vitest"
import { daemonRuntime } from "../../src/core/daemon-runtime.ts"
import { type DaemonHarness, bootDaemonHarness, fakeOrchestrator, waitFor } from "./harness.ts"

/** One task with a local worktree — enough for the collector to have work. */
const TASKS = [{ id: "t1", repo: "/repo", worktreePath: "/repo/wt" }]

describe("collector gate honours the subscriber's channel filter", () => {
  let h: DaemonHarness
  let runs = 0

  afterEach(async () => {
    await h.close()
  })

  async function boot(): Promise<DaemonHarness> {
    runs = 0
    return bootDaemonHarness({
      orchestrator: fakeOrchestrator({ listTasks: () => TASKS }),
      server: {
        worktreeChangesTickMs: 15,
        runtime: {
          ...daemonRuntime,
          runWorktreeStatus: async () => {
            runs++
            return { added: 1, deleted: 0 }
          },
        },
      },
    })
  }

  it("a pane subscribed to unrelated channels never starts the worktree-changes poller", async () => {
    h = await boot()

    const pane = h.client()
    await pane.connect()
    await pane.subscribe({ role: "pane", channels: ["ui-prefs", "keybindings"] })

    // Many ticks' worth of wall time at a 15ms tick.
    await new Promise((r) => setTimeout(r, 300))
    expect(runs).toBe(0)

    pane.close()
  })

  it("a subscriber that DOES ask for worktree.changes starts it", async () => {
    h = await boot()

    const pane = h.client()
    await pane.connect()
    await pane.subscribe({ role: "pane", channels: ["worktree.changes"] })

    expect(await waitFor(() => runs > 0)).toBe(true)
    pane.close()
  })

  it("an unfiltered subscriber still starts it (back-compat)", async () => {
    h = await boot()

    const gui = h.client()
    await gui.connect()
    await gui.subscribe({ role: "gui" })

    expect(await waitFor(() => runs > 0)).toBe(true)
    gui.close()
  })
})
