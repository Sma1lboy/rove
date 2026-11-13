import { describe, expect, test } from "vitest"
import { rowWindowRange } from "../../src/tui-react/panes/filetree/row-window-range"

/**
 * The one property that makes windowing safe: the mounted range covers every
 * row the viewport can show. A window that is simply too small still makes
 * the timing probe faster — this is the check that tells that apart from a
 * real speedup, so it is exhaustive rather than a few sampled cases.
 */
describe("rowWindowRange covers the viewport", () => {
  const cases = [0, 1, 2, 45, 100, 2000, 5000].flatMap((rowCount) =>
    [0, 1, 7, 45, 120].flatMap((height) =>
      [0, 0.5, 1, 13, 44.25, 999, 4999, 6000].map((top) => ({ rowCount, height, top })),
    ),
  )

  test.each(cases)("top=$top height=$height rowCount=$rowCount stays in bounds", ({ top, height, rowCount }) => {
    const { start, end } = rowWindowRange(top, height, rowCount)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThanOrEqual(start)
    expect(end).toBeLessThanOrEqual(rowCount)
  })

  test.each(cases.filter((c) => c.rowCount > 0 && c.height > 0))(
    "top=$top height=$height rowCount=$rowCount mounts every visible row",
    ({ top, height, rowCount }) => {
      const { start, end } = rowWindowRange(top, height, rowCount)
      // Rows the viewport actually paints, clamped to the list.
      const firstVisible = Math.max(0, Math.min(Math.floor(top), rowCount - 1))
      const lastVisible = Math.max(0, Math.min(Math.ceil(top + height) - 1, rowCount - 1))
      expect(start).toBeLessThanOrEqual(firstVisible)
      expect(end).toBeGreaterThan(lastVisible)
    },
  )

  test.each([46, 100, 2000, 5000])("the last row is reachable when scrolled to the bottom (%i rows)", (rowCount) => {
    const height = 45
    const { start, end } = rowWindowRange(rowCount - height, height, rowCount)
    expect(end).toBe(rowCount)
    expect(start).toBeLessThanOrEqual(rowCount - height)
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
