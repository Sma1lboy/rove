import { describe, expect, test } from "bun:test"
import { type RelayStatusTimer, SLOW_DELAY_MS, createRelayStatus } from "../src/relay-status.ts"

function makeHarness() {
  const shown: Array<{ text: string; tone: string; retryLabel?: string }> = []
  let scheduled: { fn: () => void; ms: number } | null = null
  let cleared = 0
  const timer: RelayStatusTimer = {
    set(fn, ms) {
      scheduled = { fn, ms }
      return 1 as unknown as ReturnType<typeof setTimeout>
    },
    clear() {
      scheduled = null
      cleared += 1
    },
  }
  const ctrl = createRelayStatus(
    {
      show(text, tone, retryLabel) {
        shown.push({ text, tone, retryLabel })
      },
    },
    SLOW_DELAY_MS,
    timer,
  )
  return {
    ctrl,
    shown,
    delay: () => scheduled?.ms ?? null,
    fire: () => {
      const fn = scheduled?.fn
      scheduled = null
      fn?.()
    },
    cleared: () => cleared,
  }
}

describe("relay splash status", () => {
  test("stays silent during a fast load and cancels the timer on completion", () => {
    const h = makeHarness()
    h.ctrl.loading("connecting…")
    expect(h.shown).toEqual([])
    expect(h.delay()).toBe(SLOW_DELAY_MS)
    h.ctrl.loading("loading rove…")
    expect(h.shown).toEqual([])
    h.ctrl.done()
    expect(h.cleared()).toBe(1)
    h.fire()
    expect(h.shown).toEqual([])
  })

  test("reveals the latest loading phase after the slow delay and updates live afterward", () => {
    const h = makeHarness()
    h.ctrl.loading("connecting…")
    h.ctrl.loading("loading rove…")
    expect(h.shown).toEqual([])
    h.fire()
    expect(h.shown).toEqual([{ text: "loading rove…", tone: "loading", retryLabel: undefined }])
    h.ctrl.loading("still loading…")
    expect(h.shown[1]).toEqual({ text: "still loading…", tone: "loading", retryLabel: undefined })
  })

  test("shows errors immediately with a retry label and cancels pending slow reveal", () => {
    const h = makeHarness()
    h.ctrl.loading("connecting…")
    h.ctrl.error("your computer is not answering", "Retry")
    expect(h.cleared()).toBe(1)
    expect(h.shown).toEqual([{ text: "your computer is not answering", tone: "error", retryLabel: "Retry" }])
  })

  test("shows unpaired info immediately without a retry button", () => {
    const h = makeHarness()
    h.ctrl.info("open the relay link")
    expect(h.shown).toEqual([{ text: "open the relay link", tone: "info", retryLabel: undefined }])
  })
})
