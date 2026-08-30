/**
 * The new-task dialog's picker window has to follow the viewport height.
 *
 * `Dialog` sizes its card to content under a `maxCardHeight` cap and nothing
 * scrolls it — its own comment says tall cards "hit the cap and clip". The
 * picker window was a flat 8 rows regardless of terminal height, which made
 * the dialog's height a constant while the room for it was not. On a 24-row
 * terminal the Existing tab overran the cap and the bottom rows went with
 * it: the Create button, and `submitError` — so a failed create looked like
 * nothing happening at all.
 */

import { describe, expect, test } from "vitest"
import { PICKER_MAX_VISIBLE, pickerVisibleRows, windowAround } from "../../src/tui/component/new-task-dialog/state.ts"

describe("pickerVisibleRows", () => {
  test("a tall terminal keeps the full window — desktop layout unchanged", () => {
    expect(pickerVisibleRows(40)).toBe(PICKER_MAX_VISIBLE)
    expect(pickerVisibleRows(60)).toBe(PICKER_MAX_VISIBLE)
  })

  test("24 rows — the regression height — yields a window the card can hold", () => {
    expect(pickerVisibleRows(24)).toBeLessThan(PICKER_MAX_VISIBLE)
    expect(pickerVisibleRows(24)).toBeGreaterThanOrEqual(2)
  })

  test("never returns fewer than two rows, however short the terminal", () => {
    // Two rows plus the `↓ N more` line still reads as a list and still
    // scrolls under the cursor, so no entry becomes unreachable.
    for (const h of [0, 1, 10, 18, 20]) expect(pickerVisibleRows(h)).toBeGreaterThanOrEqual(2)
  })

  test("monotonic in height — a taller terminal never shows fewer rows", () => {
    for (let h = 10; h < 60; h++) expect(pickerVisibleRows(h + 1)).toBeGreaterThanOrEqual(pickerVisibleRows(h))
  })

  test("a shrunk window still reaches every entry by scrolling", () => {
    const list = Array.from({ length: 30 }, (_, i) => `branch-${i}`)
    const cap = pickerVisibleRows(24)
    // The cursor is always inside its own window, at both ends and in between.
    for (const cursor of [0, 7, 15, 29]) {
      const w = windowAround(list, cursor, cap)
      expect(w.items.length).toBe(cap)
      expect(cursor).toBeGreaterThanOrEqual(w.start)
      expect(cursor).toBeLessThan(w.start + w.items.length)
      expect(w.total).toBe(30) // the `↓ N more` count stays honest
    }
  })
})
