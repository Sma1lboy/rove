import { expect, test } from "bun:test"
import { isBackSwipe } from "../src/back-swipe.ts"

test("only a clear rightward drag goes back: not a tap, a leftward drag, or a scroll that drifted sideways", () => {
  expect(isBackSwipe(120, 10)).toBe(true)
  expect(isBackSwipe(20, 0)).toBe(false)
  expect(isBackSwipe(-120, 0)).toBe(false)
  expect(isBackSwipe(100, 80)).toBe(false)
})
