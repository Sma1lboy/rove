import { startTicker } from "@sma1lboy/kobe-daemon/daemon/ticker"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The shared daemon ticker.
 *
 * Seven collectors used to hand-roll this skeleton, and the three ways they
 * legitimately differ — ungated vs gated, a two-term gate, an immediate first
 * tick — are now explicit options rather than the shape of the code. The
 * brief that prompted the extraction warned that getting the first-tick timing
 * or the gate wrong "changes startup timing, not correctness, and no test will
 * catch it", so this file is that test.
 */

describe("startTicker", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("is a no-op at tickMs <= 0, immediate pass included", () => {
    // The harness boots a daemon with collectors zeroed, and `setInterval(fn, 0)`
    // is a hot loop — which is what `quota-resume` and `quota-usage-cache` armed
    // before they shared this guard.
    const run = vi.fn()
    const onStop = vi.fn()
    const stop = startTicker({ name: "t", tickMs: 0, immediate: true, run, onStop })
    vi.advanceTimersByTime(10_000)
    expect(run).not.toHaveBeenCalled()
    stop()
    // A disabled ticker never started the collector, so it must not stop one.
    expect(onStop).not.toHaveBeenCalled()
  })

  it("waits for the first interval unless `immediate` says otherwise", () => {
    const lazy = vi.fn()
    const eager = vi.fn()
    startTicker({ name: "lazy", tickMs: 100, run: lazy })
    startTicker({ name: "eager", tickMs: 100, immediate: true, run: eager })

    expect(lazy).toHaveBeenCalledTimes(0)
    expect(eager).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(100)
    expect(lazy).toHaveBeenCalledTimes(1)
    expect(eager).toHaveBeenCalledTimes(2)
  })

  it("checks the gate on every pass, the immediate one included", () => {
    let open = false
    const run = vi.fn()
    startTicker({ name: "t", tickMs: 100, immediate: true, gate: () => open, run })

    expect(run).not.toHaveBeenCalled() // immediate pass, gate shut
    vi.advanceTimersByTime(100)
    expect(run).not.toHaveBeenCalled()
    open = true
    vi.advanceTimersByTime(100)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("runs ungated when no gate is supplied", () => {
    // `quota-resume` and the automation sweep are
    // ungated ON PURPOSE — a schedule that requires an audience is not a
    // schedule — so the helper must never default one on.
    const run = vi.fn()
    startTicker({ name: "t", tickMs: 100, run })
    vi.advanceTimersByTime(300)
    expect(run).toHaveBeenCalledTimes(3)
  })

  it("drops a tick that lands while the previous pass is still running", async () => {
    let release: (() => void) | undefined
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    startTicker({ name: "t", tickMs: 100, run })

    await vi.advanceTimersByTimeAsync(300)
    expect(run).toHaveBeenCalledTimes(1)

    release?.()
    await vi.advanceTimersByTimeAsync(100)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it("keeps ticking after a pass throws", async () => {
    // A wedged reentrancy flag would silently stop the collector for the rest
    // of the daemon's life, with only one log line to show for it.
    const run = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined)
    startTicker({ name: "t", tickMs: 100, immediate: true, run })

    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it("stops scheduling immediately and drains an in-flight write before returning", async () => {
    let finish = () => {}
    const write = new Promise<void>((resolve) => {
      finish = resolve
    })
    const run = vi.fn(() => write)
    const stop = startTicker({ name: "write", tickMs: 100, immediate: true, run })
    let closed = false
    const pending = stop().then(() => {
      closed = true
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(closed).toBe(false)
    expect(run).toHaveBeenCalledTimes(1)
    finish()
    await pending
    expect(closed).toBe(true)
    await stop()
  })

  it("stops the interval and runs onStop", () => {
    const run = vi.fn()
    const onStop = vi.fn()
    const stop = startTicker({ name: "t", tickMs: 100, run, onStop })
    vi.advanceTimersByTime(100)
    expect(run).toHaveBeenCalledTimes(1)

    stop()
    expect(onStop).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("drains the active pass even when extra teardown throws", async () => {
    let finish = () => {}
    const run = new Promise<void>((resolve) => {
      finish = resolve
    })
    const stop = startTicker({
      name: "write",
      tickMs: 100,
      immediate: true,
      run: () => run,
      onStop: () => {
        throw new Error("close failed")
      },
    })
    let rejected = false
    const pending = stop().catch(() => {
      rejected = true
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(rejected).toBe(false)
    finish()
    await pending
    expect(rejected).toBe(true)
  })

  it("unrefs the timer", () => {
    // Without this a gui-less daemon never exits and `rove daemon restart`
    // hangs — the one property here whose absence is invisible in tests that
    // only count passes.
    const unref = vi.fn()
    const spy = vi.spyOn(globalThis, "setInterval").mockReturnValue({ unref } as unknown as NodeJS.Timeout)
    try {
      startTicker({ name: "t", tickMs: 100, run: () => {} })
      expect(unref).toHaveBeenCalledTimes(1)
    } finally {
      spy.mockRestore()
    }
  })
})
