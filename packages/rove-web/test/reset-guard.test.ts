import { afterEach, expect, test, vi } from "bun:test"
import { beginReset, endReset, exitIsReset } from "../src/reset-guard.ts"

afterEach(() => vi.useRealTimers())

test("an exit while a reset is in flight is the reset, and a real exit after the grace window is not", () => {
  vi.useFakeTimers()
  expect(exitIsReset("t::tab-1")).toBe(false)
  beginReset("t::tab-1")
  // The old shell ends mid-reset, and again just after the reply: neither closes the tab.
  expect(exitIsReset("t::tab-1")).toBe(true)
  endReset("t::tab-1", 20)
  expect(exitIsReset("t::tab-1")).toBe(true)
  vi.advanceTimersByTime(20)
  expect(exitIsReset("t::tab-1")).toBe(false)
})

test("a reset only shields its own stream", () => {
  beginReset("t::tab-2")
  expect(exitIsReset("t::tab-3")).toBe(false)
  endReset("t::tab-2", 0)
})
