import { describe, expect, test } from "bun:test"
import { FLOW_MAX_COLS, FLOW_MIN_COLS, FLOW_REST_TICK, FLOW_ROWS, frameAt } from "../src/ascii-flow.ts"

const lines = (text: string) => text.split("\n")

describe("first-run picture", () => {
  test.each([FLOW_MIN_COLS, 43, 61, FLOW_MAX_COLS])(
    "every frame is the same %i-column rectangle, whatever the tick",
    (cols) => {
      const ticks = Array.from({ length: 46 }, (_, i) => i * 7)
      const shapes = ticks.flatMap((tick) => {
        const { base, accent } = frameAt(tick, cols)
        return [base, accent].map((layer) => lines(layer).map((row) => row.length))
      })
      expect(shapes).toEqual(shapes.map(() => Array(FLOW_ROWS).fill(cols)))
    },
  )

  test("the grid is clamped to its range and is ASCII only", () => {
    expect(lines(frameAt(10, 3).base)[0]).toHaveLength(FLOW_MIN_COLS)
    expect(lines(frameAt(10, 500).base)[0]).toHaveLength(FLOW_MAX_COLS)
    const { base, accent } = frameAt(FLOW_REST_TICK, 50)
    expect(/^[\x20-\x7e\n]*$/.test(base + accent)).toBe(true)
  })

  test("the same tick always draws the same frame, and the cycle repeats", () => {
    expect(frameAt(33, 50)).toEqual(frameAt(33, 50))
    expect(frameAt(33, 50)).toEqual(frameAt(33 + 150, 50))
  })

  test("the picture moves between ticks and the still frame is not empty", () => {
    expect(frameAt(20, 50)).not.toEqual(frameAt(21, 50))
    expect(frameAt(FLOW_REST_TICK, 50).accent.trim().length).toBeGreaterThan(0)
  })

  test("a glyph is drawn in one layer only, so the accent never hides a trail", () => {
    const { base, accent } = frameAt(FLOW_REST_TICK, 50)
    const a = lines(accent)
    const overlaps = lines(base).flatMap((row, y) =>
      [...row].flatMap((ch, x) => (ch !== " " && a[y]?.[x] !== " " ? [[x, y]] : [])),
    )
    expect(overlaps).toEqual([])
  })
})
