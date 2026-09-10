/**
 * The tunnel's lifecycle: when a machine counts as up, what happens when its
 * forward dies, and that a stopped tunnel stops trying.
 *
 * Driven with an injected forward + health check + timer, so the retry policy
 * is tested without an ssh binary and without waiting out real backoff.
 */

import { describe, expect, it } from "vitest"
import type { MachineConfig } from "../../src/machines/registry.ts"
import { startTunnel } from "../../src/machines/tunnel.ts"

const config: MachineConfig = { host: "narwhal", auth: { kind: "key" } }

/** Drives the tunnel with queued answers and a manual clock. */
function harness(answers: { ensure: boolean[]; check: boolean[] }) {
  const pending: Array<() => void> = []
  const ensureCalls: number[] = []
  const handle = startTunnel({
    alias: "narwhal",
    config,
    remoteDaemonSocket: "/r/daemon.sock",
    remotePtySocket: "/r/pty.sock",
    home: "/tmp/rove-tunnel-test",
    ensureFn: async () => {
      ensureCalls.push(1)
      return answers.ensure.shift() ?? false
    },
    checkFn: async () => answers.check.shift() ?? true,
    setTimeoutFn: (fn) => {
      pending.push(fn)
      return 0
    },
  })
  /** Run every scheduled callback once, then let their promises settle. */
  const tick = async (): Promise<void> => {
    const due = pending.splice(0, pending.length)
    for (const fn of due) fn()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  }
  return { handle, tick, pending, ensureCalls }
}

describe("startTunnel", () => {
  it("is online once the forward is up", async () => {
    const h = harness({ ensure: [true], check: [] })
    expect(h.handle.state()).toBe("connecting")
    await h.tick()
    expect(h.handle.state()).toBe("online")
  })

  it("stays offline and keeps retrying while the machine is unreachable", async () => {
    const h = harness({ ensure: [false, false, true], check: [] })
    await h.tick()
    expect(h.handle.state()).toBe("offline")
    expect(h.pending.length).toBe(1) // a retry is scheduled
    await h.tick()
    expect(h.handle.state()).toBe("offline")
    await h.tick()
    expect(h.handle.state()).toBe("online")
  })

  it("goes offline when a live forward stops answering, then re-establishes it", async () => {
    const h = harness({ ensure: [true, true], check: [false] })
    await h.tick()
    expect(h.handle.state()).toBe("online")
    await h.tick() // the health check fires and finds the socket dead
    expect(h.handle.state()).toBe("online") // re-ensured within the same turn
    expect(h.ensureCalls.length).toBe(2)
  })

  it("stops trying once stopped", async () => {
    const h = harness({ ensure: [false], check: [] })
    await h.tick()
    h.handle.stop()
    const before = h.ensureCalls.length
    await h.tick()
    expect(h.ensureCalls.length).toBe(before)
  })
})
