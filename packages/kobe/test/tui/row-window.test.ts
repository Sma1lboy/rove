import { describe, expect, test } from "vitest"
import { rowWindowRange } from "../../src/tui-react/panes/filetree/row-window-range"

/**
 * The one property that makes windowing safe: the mounted range covers every
 * row the viewport can show. A window that is simply too small still makes
 * the timing probe faster — this is the check that tells that apart from a
 * real speedup, so it is exhaustive rather than a few sampled cases.
 */
describe("rowWindowRange covers the viewport", () => {
  test("every (top, height, rowCount) mounts every visible row", () => {
    for (const rowCount of [0, 1, 2, 45, 100, 2000, 5000]) {
      for (const height of [0, 1, 7, 45, 120]) {
        for (const top of [0, 0.5, 1, 13, 44.25, 999, 4999, 6000]) {
          const { start, end } = rowWindowRange(top, height, rowCount)
          expect(start).toBeGreaterThanOrEqual(0)
          expect(end).toBeGreaterThanOrEqual(start)
          expect(end).toBeLessThanOrEqual(rowCount)
          if (rowCount === 0 || height <= 0) continue
          // Rows the viewport actually paints, clamped to the list.
          const firstVisible = Math.max(0, Math.min(Math.floor(top), rowCount - 1))
          const lastVisible = Math.max(0, Math.min(Math.ceil(top + height) - 1, rowCount - 1))
          for (let row = firstVisible; row <= lastVisible; row++) {
            expect(
              row >= start && row < end,
              `row ${row} visible at top=${top} height=${height} count=${rowCount} but window is [${start},${end})`,
            ).toBe(true)
          }
        }
      }
    }
  })

  test("the last row is reachable when scrolled to the bottom", () => {
    for (const rowCount of [46, 100, 2000, 5000]) {
      const height = 45
      const { start, end } = rowWindowRange(rowCount - height, height, rowCount)
      expect(end).toBe(rowCount)
      expect(start).toBeLessThanOrEqual(rowCount - height)
    }
  })

  test("windows a big list down to near the viewport, not to the whole list", () => {
    // The speedup itself: 5000 rows must not mount 5000 renderables.
    const { start, end } = rowWindowRange(2500, 45, 5000)
    expect(end - start).toBeLessThan(120)
  })

  test("before first layout it mounts a bounded prefix, never nothing", () => {
    const { start, end } = rowWindowRange(0, 0, 5000)
    expect(start).toBe(0)
    expect(end).toBeGreaterThan(0)
    expect(end).toBeLessThanOrEqual(64)
  })
})
