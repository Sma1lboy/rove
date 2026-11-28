import { expect, test } from "bun:test"
import { fitFontSize } from "../src/term-zoom.ts"

test("the fitted font fills the width with whole-device-pixel cells and never overflows it", () => {
  for (const [width, cols, ratio] of [
    [382, 160, 3],
    [382, 80, 3],
    [375, 211, 2],
    [600, 97, 1],
  ]) {
    const perPx = 0.6
    const px = fitFontSize(width, cols, ratio, perPx)
    // xterm's cell: the glyph advance at this size, floored to device pixels.
    const cell = Math.floor(perPx * px * ratio) / ratio
    expect(cell * cols).toBeLessThanOrEqual(width)
    expect((cell + 1 / ratio) * cols).toBeGreaterThan(width)
  }
})
