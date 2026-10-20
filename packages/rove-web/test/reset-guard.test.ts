import { expect, test } from "bun:test"
import { beginReset, endReset, exitIsReset } from "../src/reset-guard.ts"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test("an exit while a reset is in flight is the reset, and a real exit after the grace window is not", async () => {
  expect(exitIsReset("t::tab-1")).toBe(false)
  beginReset("t::tab-1")
  // The old shell ends mid-reset, and again just after the reply: neither closes the tab.
  expect(exitIsReset("t::tab-1")).toBe(true)
  endReset("t::tab-1", 20)
  expect(exitIsReset("t::tab-1")).toBe(true)
  await sleep(50)
  expect(exitIsReset("t::tab-1")).toBe(false)
})

test("a reset only shields its own stream", () => {
  beginReset("t::tab-2")
  expect(exitIsReset("t::tab-3")).toBe(false)
  endReset("t::tab-2", 0)
})
