import { expect, test } from "bun:test"
import { completesBack, startsBack } from "../src/back-swipe.ts"

test("only a mostly rightward drag takes the panel: not a leftward one, or a scroll that drifted sideways", () => {
  expect(startsBack(12, 3)).toBe(true)
  expect(startsBack(-12, 0)).toBe(false)
  expect(startsBack(8, 12)).toBe(false)
})

test("the panel leaves a third of the way across or on a quick flick, and springs back from a short slow drag", () => {
  expect(completesBack(140, 390, 600)).toBe(true)
  expect(completesBack(60, 390, 120)).toBe(true)
  expect(completesBack(60, 390, 600)).toBe(false)
  expect(completesBack(20, 390, 80)).toBe(false)
})
