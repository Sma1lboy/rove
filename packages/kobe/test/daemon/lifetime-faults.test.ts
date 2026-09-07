import { existsSync } from "node:fs"
import { afterEach, describe, expect, it } from "vitest"
import { type DaemonHarness, bootDaemonHarness, fakeOrchestrator, waitFor } from "./harness.ts"

/**
 * The daemon's lifetime bookkeeping under a THROW.
 *
 * Each of the three cases below latches or acquires something before running
 * work that can fail, and the failure then strands the daemon in a state no
 * later call can leave: a gui refcount that never reaches 0 (so it never
 * idle-exits and every collector polls forever), or a socket + pidfile still
 * on disk in front of a daemon that has already torn its insides down and
 * answers `hello` anyway. All three fail loudly here and silently in
 * production, which is why they get a test rather than a comment.
 */

const GRACE_MS = 80

describe("daemon lifetime under a failing dependency", () => {
  let h: DaemonHarness

  afterEach(async () => {
    await h.close()
  })

  it("close() unlinks the socket even when the teardown throws partway", async () => {
    h = await bootDaemonHarness({
      orchestrator: fakeOrchestrator({
        subscribeTasks: (listener: (snapshot: unknown[]) => void) => {
          listener([])
          return () => {
            throw new Error("store unsubscribe exploded")
          }
        },
      }),
    })
    expect(existsSync(h.socketPath)).toBe(true)

    // `stopping` is already latched by the time this throws, so leaving the
    // socket behind means a zombie that answers RPCs and never retries.
    await expect(h.server.close()).resolves.toBeUndefined()
    expect(existsSync(h.socketPath)).toBe(false)
    expect(existsSync(h.pidPath)).toBe(false)
  })

  it("idle-stops through to teardown when the stop hook rejects", async () => {
    h = await bootDaemonHarness({
      env: { KOBE_DAEMON_IDLE_GRACE_MS: String(GRACE_MS) },
      server: {
        onStop: async () => {
          throw new Error("core.close exploded")
        },
      },
    })
    const client = h.client()
    await client.request("hello")
    await client.subscribe({ role: "gui" })
    expect(existsSync(h.socketPath)).toBe(true)

    client.close()
    // Nothing re-arms the idle timer once `stopping` is latched, so a stop
    // hook that takes the close down with it means the daemon never exits.
    expect(await waitFor(() => !existsSync(h.socketPath), GRACE_MS + 1000)).toBe(true)
  })
})
