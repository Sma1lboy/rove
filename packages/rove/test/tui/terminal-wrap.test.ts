/**
 * Soft-wrapped lines, in the two places a user touches text.
 *
 * The snapshot is a grid, so one logical line the emulator broke across
 * columns arrives as several rows. Without xterm's `isWrapped` both consumers
 * read that break as a real newline: a copied path comes back in pieces, and a
 * needle lying across the boundary is reported as "no matches" for text that
 * is on screen.
 *
 * Both functions take the flags as an OPTIONAL trailing argument; the calls
 * without it here are the pre-change behavior, kept as the contrast.
 */

import { describe, expect, it } from "vitest"
import type { Chunk } from "../../src/tui/panes/terminal/sgr"
import { findMatches } from "../../src/tui/panes/terminal/terminal-search"
import { extractSelection } from "../../src/tui/panes/terminal/terminal-selection"

const row = (text: string): readonly Chunk[] => [{ text }]

// One 40-column line: `ERROR in /Users/me/src/panes/terminal/search.ts:41:9`
const WRAPPED = [row("ERROR in /Users/me/src/panes/terminal/se"), row("arch.ts:41:9")]
const WRAP_FLAGS = [false, true]
const WHOLE = { anchor: { row: 0, col: 0 }, head: { row: 1, col: 11 } }

describe("copying a soft-wrapped line", () => {
  it("joins the continuation row with no separator — the path pastes as one", () => {
    expect(extractSelection(WRAPPED, WHOLE, WRAP_FLAGS)).toBe("ERROR in /Users/me/src/panes/terminal/search.ts:41:9")
    expect(extractSelection(WRAPPED, WHOLE, WRAP_FLAGS)).not.toContain("\n")
  })

  it("without the flags it still splits — that is the shape being fixed", () => {
    expect(extractSelection(WRAPPED, WHOLE)).toContain("\n")
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

describe("searching across a soft wrap", () => {
  it("finds a needle that straddles the wrap point and spans both rows", () => {
    const hits = findMatches(WRAPPED, "terminal/search.ts", WRAP_FLAGS)
    expect(hits).toHaveLength(1)
    expect(hits[0]?.anchor).toEqual({ row: 0, col: 29 })
    expect(hits[0]?.head.row).toBe(1)
    expect(hits[0]?.head.col).toBe(6)
  })

  it("without the flags the same needle is unfindable — the confident negative", () => {
    expect(findMatches(WRAPPED, "terminal/search.ts")).toHaveLength(0)
  })

  it("a needle inside one row is unchanged by the grouping", () => {
    expect(findMatches(WRAPPED, "ERROR in", WRAP_FLAGS)).toEqual([
      { anchor: { row: 0, col: 0 }, head: { row: 0, col: 7 } },
    ])
  })

  it("does not join rows the emulator did not wrap", () => {
    const rows = [row("abc"), row("def")]
    expect(findMatches(rows, "cd", [false, false])).toHaveLength(0)
    expect(findMatches(rows, "cd", [false, true])).toHaveLength(1)
  })

  it("wide glyphs still measure in cells across the join", () => {
    const rows = [row("找不"), row("到了")]
    const hits = findMatches(rows, "不到", [false, true])
    expect(hits).toEqual([{ anchor: { row: 0, col: 2 }, head: { row: 1, col: 1 } }])
  })
})
