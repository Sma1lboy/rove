/**
 * The tunnel's lifecycle: when it counts as up, and what it does when ssh dies.
 *
 * Driven with an injected spawn and an injected timer, so the reconnect policy
 * is tested without an ssh binary and without waiting out real backoff.
 */

import type { ChildProcess } from "node:child_process"
import { EventEmitter } from "node:events"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MachineConfig } from "../../src/machines/registry.ts"
import { startTunnel } from "../../src/machines/tunnel.ts"

const config: MachineConfig = { host: "narwhal", auth: { kind: "key" } }

class FakeSsh extends EventEmitter {
  killed = false
  kill(): boolean {
    this.killed = true
    return true
  }
}

function start(spawns: FakeSsh[], retries: Array<() => void>) {
  return startTunnel({
    alias: "narwhal",
    config,
    remoteDaemonSocket: "/r/daemon.sock",
    remotePtySocket: "/r/pty.sock",
    home: "/tmp/rove-tunnel-test",
    spawnFn: () => {
      const proc = new FakeSsh()
      spawns.push(proc)
      return proc as unknown as ChildProcess
    },
    setTimeoutFn: (fn) => {
      retries.push(fn)
      return 0
    },
  })
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe("startTunnel", () => {
  it("counts as online only once ssh has outlived a bind failure", () => {
    // `ssh -N` prints nothing on success, so surviving the window IS the
    // readiness signal — `ExitOnForwardFailure=yes` makes a failed bind an
    // immediate exit.
    const spawns: FakeSsh[] = []
    const handle = start(spawns, [])
    expect(handle.state()).toBe("connecting")
    vi.advanceTimersByTime(800)
    expect(handle.state()).toBe("online")
    handle.stop()
  })

  it("goes offline and schedules a retry when ssh exits", () => {
    const spawns: FakeSsh[] = []
    const retries: Array<() => void> = []
    const handle = start(spawns, retries)
    vi.advanceTimersByTime(800)
    const seen: string[] = []
    handle.onState((state) => seen.push(state))
    spawns[0]?.emit("exit", 255)
    expect(handle.state()).toBe("offline")
    expect(seen).toEqual(["offline"])
    expect(retries).toHaveLength(1)
    retries[0]?.()
    expect(spawns).toHaveLength(2)
    handle.stop()
  })

  it("stops retrying once stopped, and kills the child", () => {
    const spawns: FakeSsh[] = []
    const retries: Array<() => void> = []
    const handle = start(spawns, retries)
    vi.advanceTimersByTime(800)
    handle.stop()
    expect(spawns[0]?.killed).toBe(true)
    spawns[0]?.emit("exit", 0)
    expect(retries).toHaveLength(0)
  })
})
