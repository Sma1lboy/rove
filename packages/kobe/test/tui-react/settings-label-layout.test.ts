/**
 * The General section's label column is a budget, not a constant.
 *
 * Its rows are `overflow="hidden"` + `wrapMode="none"`, so overspending is a
 * silent hard cut — no ellipsis says it happened. The column used to be a
 * flat 30 cells regardless of terminal width, which did the most damage
 * exactly where there was least room: `docs/TUI.md` promises phone SSH down
 * to 46 columns, and at 46 the row owns 26 cells, so the padding alone
 * overran it and took the label with it.
 */

import { describe, expect, test } from "vitest"
import { LABEL_COLUMN_MAX, generalLabelLayout } from "../../src/tui/component/settings-dialog/model.ts"

/** Cells a row actually owns: width − dialog padding − sidebar − gap − Row padding. */
const rowCells = (width: number, padX: number) => width - padX * 2 - 14 - 2 - 2

describe("generalLabelLayout", () => {
  test("a desktop terminal keeps the full aligned column and its hints", () => {
    expect(generalLabelLayout(110, 2)).toEqual({ labelColumn: LABEL_COLUMN_MAX, showHint: true })
    expect(generalLabelLayout(80, 2)).toEqual({ labelColumn: LABEL_COLUMN_MAX, showHint: true })
  })

  test("46 columns (phone SSH, narrow padding): drops the hint, stops padding", () => {
    // The regression. 46 − 2 − 14 − 2 − 2 = 26 cells for the whole row, so a
    // 30-cell pad overran it by 4 before any hint text existed.
    expect(rowCells(46, 1)).toBe(26)
    const { labelColumn, showHint } = generalLabelLayout(46, 1)
    expect(showHint).toBe(false)
    expect(labelColumn).toBe(0) // natural width, nothing cut
  })

  test("50 columns: the width where a 30-cell pad consumed the budget exactly", () => {
    // rowCells === 30 here, so the old code left the hint structurally
    // unreachable — never clipped, never rendered.
    expect(rowCells(50, 1)).toBe(30)
    expect(generalLabelLayout(50, 1).showHint).toBe(false)
  })

  test("the label column never exceeds what the row owns", () => {
    for (let width = 30; width <= 200; width++) {
      for (const padX of [1, 2]) {
        const { labelColumn, showHint } = generalLabelLayout(width, padX)
        const cells = rowCells(width, padX)
        expect(labelColumn).toBeLessThanOrEqual(Math.max(0, cells))
        // Whenever a hint is shown, at least 18 cells are left for it.
        if (showHint) expect(cells - labelColumn).toBeGreaterThanOrEqual(18)
      }
    }
  })

  test("in between, the hint keeps its share and the label takes the rest", () => {
    const { labelColumn, showHint } = generalLabelLayout(64, 2)
    expect(showHint).toBe(true)
    expect(labelColumn).toBeLessThan(LABEL_COLUMN_MAX) // shrunk, not dropped
    expect(labelColumn).toBeGreaterThan(0)
  })
})
