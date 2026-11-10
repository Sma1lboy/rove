import { describe, expect, it } from "bun:test"
import { startTyping } from "../src/typing.ts"

const TIMINGS = { keepaliveMs: 10, warmupMs: 100, maxMs: 1_000 }

function harness(running: () => boolean) {
  const sent: boolean[] = []
  const handle = startTyping(
    {
      send: async (on) => {
        sent.push(on)
      },
      isRunning: async () => running(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: Date.now,
      log: () => {},
    },
    TIMINGS,
  )
  return { sent, handle }
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
    const started = Date.now()
    const { sent, handle } = harness(() => true)
    await handle.done
    expect(Date.now() - started).toBeGreaterThanOrEqual(TIMINGS.maxMs)
    expect(sent.at(-1)).toBe(false)
  })

  it("a failing send is logged, not thrown, and the indicator still clears", async () => {
    const logs: string[] = []
    const handle = startTyping(
      {
        send: async (on) => {
          if (on) throw new Error("ret=-1")
        },
        isRunning: async () => false,
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        now: Date.now,
        log: (m) => logs.push(m),
      },
      TIMINGS,
    )
    await handle.done
    expect(logs[0]).toContain("typing on failed")
  })
})
