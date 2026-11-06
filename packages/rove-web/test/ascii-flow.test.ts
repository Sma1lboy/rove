import { describe, expect, test } from "bun:test"
import { FLOW_MAX_COLS, FLOW_MIN_COLS, FLOW_REST_TICK, FLOW_ROWS, frameAt } from "../src/ascii-flow.ts"

const lines = (text: string) => text.split("\n")

describe("first-run picture", () => {
  test("every frame is the same rectangle, whatever the tick or width", () => {
    for (const cols of [FLOW_MIN_COLS, 43, 61, FLOW_MAX_COLS]) {
      for (let tick = 0; tick < 320; tick += 7) {
        const { base, accent } = frameAt(tick, cols)
        for (const layer of [base, accent]) {
          const rows = lines(layer)
          expect(rows).toHaveLength(FLOW_ROWS)
          for (const row of rows) expect(row).toHaveLength(cols)
        }
      }
    }
  })

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
    lines(base).forEach((row, y) => {
      for (let x = 0; x < row.length; x++) expect(row[x] === " " || a[y]?.[x] === " ").toBe(true)
    })
  })
})
