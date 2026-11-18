import { describe, expect, it } from "bun:test"
import { startTyping } from "../src/typing.ts"

const TIMINGS = { keepaliveMs: 10, warmupMs: 100, maxMs: 1_000 }

/** A virtual clock: each sleep advances it, so no test waits on real time. */
function clock() {
  const t = { now: 0 }
  const sleep = async (ms: number) => {
    t.now += ms
  }
  return { t, sleep, now: () => t.now }
}

function harness(running: () => boolean) {
  const sent: boolean[] = []
  const { t, sleep, now } = clock()
  const handle = startTyping(
    {
      send: async (on) => {
        sent.push(on)
      },
      isRunning: async () => running(),
      sleep,
      now,
      log: () => {},
    },
    TIMINGS,
  )
  return { sent, handle, t }
}

describe("startTyping", () => {
  it("clears after the warm-up when the turn never shows as running", async () => {
    const { sent, handle } = harness(() => false)
    await handle.done
    expect(sent[0]).toBe(true)
    expect(sent.at(-1)).toBe(false)
    expect(sent.filter((on) => !on)).toHaveLength(1)
  })

  it("stops at the ceiling for a turn that never ends", async () => {
    const { sent, handle, t } = harness(() => true)
    await handle.done
    expect(t.now).toBeGreaterThanOrEqual(TIMINGS.maxMs)
    expect(sent.at(-1)).toBe(false)
  })

  it("a failing send is logged, not thrown, and the indicator still clears", async () => {
    const logs: string[] = []
    const handle = startTyping(
      {
        send: async () => {
          throw new Error("ret=-1")
        },
        isRunning: async () => false,
        ...clock(),
        log: (m) => logs.push(m),
      },
      TIMINGS,
    )
    await handle.done
    expect(logs[0]).toContain("typing on failed")
  })
})
