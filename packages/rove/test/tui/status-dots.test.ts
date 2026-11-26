import { dotsGlyph, litDots } from "@/tui/lib/status-dots"
import { expect, test } from "vitest"

test("the 3×3 grid lands in two braille cells, and work never draws a settled shape", () => {
  // Top-left dot, centre dot, bottom-right dot: both columns of the first cell, the left of the second.
  expect(dotsGlyph([0])).toBe("\u2801\u2800")
  expect(dotsGlyph([4])).toBe("\u2810\u2800")
  expect(dotsGlyph([8])).toBe("\u2800\u2804")
  const settled = (["idle", "done", "error", "waiting"] as const).map((look) => dotsGlyph(litDots(look, 0)))
  expect(new Set(settled).size).toBe(4)
  const working = Array.from({ length: 16 }, (_, tick) => dotsGlyph(litDots("working", tick * 100)))
  expect(working.filter((glyph) => settled.includes(glyph))).toEqual([])
})
