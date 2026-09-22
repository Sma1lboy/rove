import { DaemonLifetime, type LifetimeClient, type ScheduleFn } from "@sma1lboy/kobe-daemon/daemon/lifetime"
import { describe, expect, it, vi } from "vitest"

/**
 * Unit coverage for the daemon's lazy-shutdown + collector-gate policy in
 * isolation — no socket, no wall-clock grace. The end-to-end socket behavior is
 * covered by lazy-shutdown.test.ts; this pins the policy rules so a refactor of
 * server.ts can't silently change when the daemon self-stops.
 */

/** A manual clock: captures scheduled callbacks so a test fires them on demand,
 *  and honors cancellation exactly as the real unref'd setTimeout would. */
function manualClock(): { schedule: ScheduleFn; fire: () => void } {
  const pending: Array<{ fn: () => void; cancelled: boolean }> = []
  const schedule: ScheduleFn = (fn) => {
    const entry = { fn, cancelled: false }
    pending.push(entry)
    return () => {
      entry.cancelled = true
    }
  }
  return {
    schedule,
    fire: () => {
      for (const e of pending) if (!e.cancelled) e.fn()
    },
  }
}

const GUI: LifetimeClient = { subscribed: true, holdsLifetime: true }
const PANE: LifetimeClient = { subscribed: true, holdsLifetime: false }

function make(clients: LifetimeClient[], opts: { firstGuiGraceMs?: number; keepAlive?: () => boolean } = {}) {
  const clock = manualClock()
  const onIdleStop = vi.fn()
  const lifetime = new DaemonLifetime({
    clients: () => clients,
    idleGraceMs: 50,
    ...opts,
    onIdleStop,
    schedule: clock.schedule,
    log: () => {},
  })
  return { lifetime, onIdleStop, clock, clients }
}

describe("DaemonLifetime", () => {
  it("markStopping cancels a pending grace and suppresses re-arm", () => {
    const { lifetime, onIdleStop, clock, clients } = make([GUI])
    clients.length = 0
    lifetime.clientDisconnected(true) // arms
    lifetime.markStopping()
    expect(lifetime.isStopping()).toBe(true)
    clock.fire()
    expect(onIdleStop).not.toHaveBeenCalled()
    // A later disconnect can't re-arm once stopping.
    lifetime.clientDisconnected(true)
    clock.fire()
    expect(onIdleStop).not.toHaveBeenCalled()
  })

  // Why: the arm-on-transition rule alone means a daemon that NEVER sees a
  // gui never self-stops — a daemon autospawned by a helper inside an engine
  // tab then holds the socket for days. Autospawned daemons arm a boot-time
  // first-gui grace instead.
  it("firstGuiGraceMs: an autospawned daemon that never sees a gui self-stops", () => {
    const { onIdleStop, clock } = make([PANE], { firstGuiGraceMs: 100 })
    clock.fire()
    expect(onIdleStop).toHaveBeenCalledTimes(1)
  })

  it("firstGuiGraceMs: the first gui attach cancels the boot grace", () => {
    const { lifetime, onIdleStop, clock, clients } = make([], { firstGuiGraceMs: 100 })
    clients.push(GUI)
    lifetime.guiAttached()
    clock.fire()
    expect(onIdleStop).not.toHaveBeenCalled()
  })
})

/**
 * The keep-alive hold exists for scheduled Automations: a schedule that only
 * fires while a human happens to be looking at kobe is not a schedule. It must
 * both engage AND release — a hold that never lets go is a leak.
 */
describe("keep-alive hold", () => {
  it("keeps the daemon up with no gui attached", () => {
    const clients: LifetimeClient[] = [GUI]
    const { lifetime, onIdleStop, clock } = make(clients, { keepAlive: () => true })
    clients.length = 0
    lifetime.clientDisconnected(true)
    clock.fire()
    expect(onIdleStop).not.toHaveBeenCalled()
  })

  it("suppresses arming entirely rather than arming a timer it would veto", () => {
    // A hold present at disconnect means NO grace timer is scheduled at all —
    // which is why releasing one later needs `reevaluateIdle` (next test) and
    // cannot rely on a pending timer re-checking the condition.
    const clients: LifetimeClient[] = [GUI]
    let held = true
    const { lifetime, onIdleStop, clock } = make(clients, { keepAlive: () => held })
    clients.length = 0
    lifetime.clientDisconnected(true)
    held = false
    clock.fire()
    expect(onIdleStop).not.toHaveBeenCalled()
  })

  it("re-checks a hold that appears while a grace timer is already pending", () => {
    // The timer here was armed with no hold, so a hold appearing mid-grace
    // must still be honoured when it fires.
    const clients: LifetimeClient[] = [GUI]
    let held = false
    const { lifetime, onIdleStop, clock } = make(clients, { keepAlive: () => held })
    clients.length = 0
    lifetime.clientDisconnected(true)
    held = true
    clock.fire()
    expect(onIdleStop).not.toHaveBeenCalled()
  })

  it("self-stops via reevaluateIdle when the last hold is released", () => {
    // The hole this closes: arming is otherwise driven only by gui
    // disconnects, so deleting the last automation after the gui already left
    // would leave nothing to notice, and the daemon would live forever.
    const clients: LifetimeClient[] = [GUI]
    let held = true
    const { lifetime, onIdleStop, clock } = make(clients, { keepAlive: () => held })
    clients.length = 0
    lifetime.clientDisconnected(true)
    clock.fire()
    expect(onIdleStop).not.toHaveBeenCalled()

    held = false
    lifetime.reevaluateIdle()
    clock.fire()
    expect(onIdleStop).toHaveBeenCalledOnce()
  })
})
