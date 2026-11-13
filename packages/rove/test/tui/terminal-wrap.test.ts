/**
 * Soft-wrapped lines in copy.
 *
 * The snapshot is a grid, so one logical line the emulator broke across
 * columns arrives as several rows. Without xterm's `isWrapped` the copy reads
 * that break as a real newline and a copied path comes back in pieces.
 */

import { describe, expect, it } from "vitest"
import type { Chunk } from "../../src/tui/panes/terminal/sgr"
import { extractSelection } from "../../src/tui/panes/terminal/terminal-selection"

const row = (text: string): readonly Chunk[] => [{ text }]

// One 40-column line: `ERROR in /Users/me/src/panes/terminal/search.ts:41:9`
const WRAPPED = [row("ERROR in /Users/me/src/panes/terminal/se"), row("arch.ts:41:9")]
const WRAP_FLAGS = [false, true]
const WHOLE = { anchor: { row: 0, col: 0 }, head: { row: 1, col: 11 } }

describe("copying a soft-wrapped line", () => {
  it("joins the continuation row with no separator — the path pastes as one", () => {
    expect(extractSelection(WRAPPED, WHOLE, WRAP_FLAGS)).toBe("ERROR in /Users/me/src/panes/terminal/search.ts:41:9")
  })

  it("a REAL newline between two rows still separates them", () => {
    const rows = [row("first"), row("second"), row("third")]
    const range = { anchor: { row: 0, col: 0 }, head: { row: 2, col: 4 } }
    expect(extractSelection(rows, range, [false, false, false])).toBe("first\nsecond\nthird")
  })

  it("trailing padding is trimmed per LOGICAL line, so a wrap point keeps its spaces", () => {
    // "a b" wrapped mid-way: the break falls between "a " and "b", and the
    // space the user selected is inside the line, not padding at its end.
    const rows = [row("hello world "), row("again    ")]
    const range = { anchor: { row: 0, col: 0 }, head: { row: 1, col: 8 } }
    expect(extractSelection(rows, range, [false, true])).toBe("hello world again")
  })

  it("a selection that STARTS on a continuation row opens its own line", () => {
    const range = { anchor: { row: 1, col: 0 }, head: { row: 1, col: 11 } }
    expect(extractSelection(WRAPPED, range, WRAP_FLAGS)).toBe("arch.ts:41:9")
  })
})
