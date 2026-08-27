import { describe, expect, it } from "vitest"
import { displayWidth } from "../../src/lib/display-width"
import { ATTR, type Chunk } from "../../src/tui/panes/terminal/sgr"
import {
  EMPTY_SHADOW,
  clampRowToShadow,
  extractSelection,
  extractShadowedSelection,
  orderRange,
  overlaySelection,
  pointerCell,
  rowSpan,
  shiftShadow,
  snapshotShift,
} from "../../src/tui/panes/terminal/terminal-selection"

const row = (text: string): readonly Chunk[] => [{ text }]

const ROWS = [row("alpha bravo   "), row("charlie delta "), row("echo          ")]

describe("terminal grid selection", () => {
  it("orderRange normalizes an upward/backward drag into reading order", () => {
    const r = orderRange({ anchor: { row: 2, col: 3 }, head: { row: 0, col: 5 } })
    expect(r.start).toEqual({ row: 0, col: 5 })
    expect(r.end).toEqual({ row: 2, col: 3 })
    const same = orderRange({ anchor: { row: 1, col: 7 }, head: { row: 1, col: 2 } })
    expect(same.start.col).toBe(2)
  })

  it("rowSpan follows linear semantics: first row from startCol, middle whole, last to endCol", () => {
    const range = { anchor: { row: 0, col: 6 }, head: { row: 2, col: 1 } }
    expect(rowSpan(range, 0, 14)).toEqual([6, 14])
    expect(rowSpan(range, 1, 14)).toEqual([0, 14])
    expect(rowSpan(range, 2, 14)).toEqual([0, 2])
    expect(rowSpan(range, 3, 14)).toBeNull()
  })

  it("extractSelection slices by span and trims each line's padding", () => {
    const range = { anchor: { row: 0, col: 6 }, head: { row: 2, col: 1 } }
    expect(extractSelection(ROWS, range)).toBe("bravo\ncharlie delta\nec")
    // Single-row word drag, backwards.
    expect(extractSelection(ROWS, { anchor: { row: 1, col: 6 }, head: { row: 1, col: 0 } })).toBe("charlie")
  })

  it("keeps the empty first line when a multi-row drag anchors past a short row's text", () => {
    // Real snapshot rows are TRIMMED, not grid-padded, and the mouse column is
    // clamped to the grid width — so a drag can anchor in the blank padding
    // past a short first line (here col 5, past "ab"). That row is still part
    // of the selection (overlaySelection highlights it), so the copy must keep
    // it as an empty line, preserving the newline into the next row.
    const rows = [row("ab"), row("cdef")]
    const range = { anchor: { row: 0, col: 5 }, head: { row: 1, col: 2 } }
    expect(extractSelection(rows, range)).toBe("\ncde")
    // overlaySelection (grid width 8) does highlight that first row — the two
    // sides must agree on which rows are selected.
    const painted = overlaySelection(rows, range, 0, 8)[0].filter((c) => ((c.attributes ?? 0) & ATTR.INVERSE) !== 0)
    expect(painted.length).toBeGreaterThan(0)
  })

  it("preserves an interior blank line across a multi-row selection", () => {
    // A wholly-blank middle row (trimmed to empty) must survive as "" so the
    // reading-order line structure — and its newlines — is intact.
    const rows = [row("first"), row(""), row("third")]
    const range = { anchor: { row: 0, col: 0 }, head: { row: 2, col: 4 } }
    expect(extractSelection(rows, range)).toBe("first\n\nthird")
  })

  it("overlaySelection inverses exactly the selected cells of visible rows", () => {
    const range = { anchor: { row: 1, col: 8 }, head: { row: 1, col: 12 } }
    // Viewport starting at absolute row 1 → the selected row is index 0.
    const out = overlaySelection([ROWS[1]], range, 1, 14)
    const chunks = out[0]
    expect(chunks.map((c) => c.text).join("")).toBe("charlie delta ")
    const inverse = chunks.filter((c) => ((c.attributes ?? 0) & ATTR.INVERSE) !== 0)
    expect(inverse.map((c) => c.text).join("")).toBe("delta")
    // Rows outside the range come back untouched (same reference).
    expect(overlaySelection([ROWS[0]], range, 0, 14)[0]).toBe(ROWS[0])
  })

  it("overlaySelection paints highlight over unpainted padding cells", () => {
    const short = [row("ab")]
    const range = { anchor: { row: 0, col: 0 }, head: { row: 0, col: 5 } }
    const out = overlaySelection(short, range, 0, 10)
    expect(out[0].map((c) => c.text).join("")).toBe("ab    ")
  })

  it("overlaySelection lands the padding highlight on the selected cells when the span starts past the text", () => {
    // The drag anchors in the blank padding to the right of a short line
    // (cols 5-7, past "ab" which paints only cols 0-1). The highlight must
    // sit on cols 5-7, with cols 2-4 left as unhighlighted padding — not
    // shifted left onto cols 2-4 (the regression this guards).
    const short = [row("ab")]
    const range = { anchor: { row: 0, col: 5 }, head: { row: 0, col: 7 } }
    const out = overlaySelection(short, range, 0, 10)[0]
    // Full row is 8 cells: "ab" + three plain spaces + three inverse spaces.
    expect(out.map((c) => c.text).join("")).toBe("ab      ")
    expect(displayWidth(out.map((c) => c.text).join(""))).toBe(8)
    const plain = out
      .filter((c) => ((c.attributes ?? 0) & ATTR.INVERSE) === 0)
      .map((c) => c.text)
      .join("")
    const inverse = out
      .filter((c) => ((c.attributes ?? 0) & ATTR.INVERSE) !== 0)
      .map((c) => c.text)
      .join("")
    expect(plain).toBe("ab   ") // "ab" + the 3-cell gap, unhighlighted
    expect(inverse).toBe("   ") // exactly the 3 selected padding cells
  })

  it("extracts a CJK range by terminal cells in either drag direction", () => {
    const cjk = [row("唯一需要区分的是：")]
    const forward = { anchor: { row: 0, col: 4 }, head: { row: 0, col: 9 } }
    const backward = { anchor: forward.head, head: forward.anchor }

    expect(extractSelection(cjk, forward)).toBe("需要区")
    expect(extractSelection(cjk, backward)).toBe("需要区")
  })

  it("highlights whole wide glyphs without over-padding the row", () => {
    const cjk = [row("你a")]
    const range = { anchor: { row: 0, col: 0 }, head: { row: 0, col: 4 } }
    const out = overlaySelection(cjk, range, 0, 5)[0]
    const painted = out.filter((c) => ((c.attributes ?? 0) & ATTR.INVERSE) !== 0)

    expect(painted.map((c) => c.text).join("")).toBe("你a  ")
    expect(displayWidth(out.map((c) => c.text).join(""))).toBe(5)
  })

  it("selects a whole wide glyph when the range hits its trailing cell", () => {
    const cjk = [row("你a")]
    const range = { anchor: { row: 0, col: 1 }, head: { row: 0, col: 1 } }

    // A zero-width drag is normally filtered by the hook; the pure overlay
    // still defines how a one-cell range inside a wide glyph is painted.
    const out = overlaySelection(cjk, range, 0, 3)[0]
    const painted = out.filter((c) => ((c.attributes ?? 0) & ATTR.INVERSE) !== 0)
    expect(painted.map((c) => c.text).join("")).toBe("你")
  })

  it("keeps emoji cell coordinates aligned across styled chunks", () => {
    const styled: readonly (readonly Chunk[])[] = [[{ text: "🚀", fg: [1, 2, 3] }, { text: "go" }]]
    const range = { anchor: { row: 0, col: 2 }, head: { row: 0, col: 2 } }

    expect(extractSelection(styled, range)).toBe("g")
    const out = overlaySelection(styled, range, 0, 4)[0]
    const painted = out.filter((c) => ((c.attributes ?? 0) & ATTR.INVERSE) !== 0)
    expect(painted.map((c) => c.text).join("")).toBe("g")
  })

  it("keeps zero-width marks attached before, inside, and after a selection", () => {
    const decomposed = "a\u0301b\u0301c\u0301"
    const rows = [row(decomposed)]
    const range = { anchor: { row: 0, col: 1 }, head: { row: 0, col: 1 } }

    expect(displayWidth(decomposed)).toBe(3)
    expect(extractSelection(rows, range)).toBe("b\u0301")
    const out = overlaySelection(rows, range, 0, 3)[0]
    expect(out.map((c) => c.text).join("")).toBe(decomposed)
    const painted = out.filter((c) => ((c.attributes ?? 0) & ATTR.INVERSE) !== 0)
    expect(painted.map((c) => c.text).join("")).toBe("b\u0301")
  })
})

describe("pointerCell", () => {
  // 10 visible rows starting at snapshot row 40, in a 200-row snapshot.
  const grid = { cols: 80, rows: 10 }
  const at = (col: number, row: number, start = 40) => pointerCell(col, row, grid, start, 200)

  it("maps a pointer inside the pane to its absolute row, with no pull", () => {
    expect(at(5, 3)).toEqual({ cell: { row: 43, col: 5 }, edgePull: 0 })
    expect(at(0, 1).edgePull).toBe(0)
    expect(at(0, 8).edgePull).toBe(0)
  })

  it("pulls from the edge ROW, not only from beyond it", () => {
    // The pane sits flush under a one-row tab strip: a drag held on the first
    // visible row is the gesture, and it has to scroll.
    expect(at(2, 0)).toEqual({ cell: { row: 40, col: 2 }, edgePull: -1 })
    expect(at(2, 9)).toEqual({ cell: { row: 49, col: 2 }, edgePull: 1 })
  })

  it("pulls harder the further past the edge the pointer sits", () => {
    // The row above the viewport is real scrollback — addressable, and the
    // negative pull is what drives auto-scroll toward it.
    expect(at(2, -1)).toEqual({ cell: { row: 39, col: 2 }, edgePull: -2 })
    expect(at(2, -7).edgePull).toBe(-8)
    expect(at(2, 14).edgePull).toBe(6)
  })

  it("clamps the cell to the snapshot and the grid width", () => {
    expect(at(999, 2).cell.col).toBe(79)
    expect(at(-4, 2).cell.col).toBe(0)
    expect(at(0, -100, 40).cell.row).toBe(0) // above the buffer → first row
    expect(at(0, 500, 190).cell.row).toBe(199) // past the buffer → last row
    expect(pointerCell(0, 0, grid, 0, 0).cell.row).toBe(0) // empty snapshot
  })
})

describe("alt-screen drag scrolling (shadow buffer)", () => {
  // A 20-line document seen through a 5-row alternate screen. `screen(top)`
  // is the app's repaint after scrolling to `top` — one full screen, no
  // scrollback, exactly what an engine tab's snapshot looks like.
  const doc = Array.from({ length: 20 }, (_, i) => `line-${String(i + 1).padStart(2, "0")}`)
  const screen = (top: number): (readonly Chunk[])[] => doc.slice(top, top + 5).map(row)

  it("snapshotShift measures the content displacement, not the wheel ticks", () => {
    // Scroll up (older content): the surviving rows sit LOWER on screen.
    expect(snapshotShift(screen(15), screen(13))).toBe(2)
    // Scroll down: they sit higher.
    expect(snapshotShift(screen(11), screen(14))).toBe(-3)
    // Nothing moved.
    expect(snapshotShift(screen(10), screen(10))).toBe(0)
  })

  it("snapshotShift stays at 0 for a repaint no shift explains", () => {
    // Full repaint with unrelated content: no candidate shift reaches a
    // majority — the selection must stay screen-fixed, not jump.
    const other = ["alpha", "bravo", "charlie", "delta", "echo"].map(row)
    expect(snapshotShift(screen(0), other)).toBe(0)
    // All-blank rows match any shift; ambiguity must resolve to "no move".
    const blank = ["", "", "", "", ""].map(row)
    expect(snapshotShift(blank, blank)).toBe(0)
    // A status line changing in place is not a scroll.
    const spinner = [...screen(5).slice(0, 4), row("busy ⠧")]
    const spinner2 = [...screen(5).slice(0, 4), row("busy ⠇")]
    expect(snapshotShift(spinner, spinner2)).toBe(0)
  })

  it("banks scrolled-off rows and extracts the full drag, off-screen rows included", () => {
    // Anchor pressed on row 3 (line-19), head dragged to the top edge; the
    // app then scrolls up twice by 2 lines. The anchor follows the content
    // off the bottom; the copy must contain every line the drag covered.
    let shadow = EMPTY_SHADOW
    let anchor = { row: 3, col: 10 }
    let visible = screen(15)
    for (const top of [13, 11]) {
      const next = screen(top)
      const shift = snapshotShift(visible, next)
      expect(shift).toBe(2)
      shadow = shiftShadow(shadow, visible, shift)
      anchor = { row: clampRowToShadow(anchor.row + shift, next.length, shadow), col: anchor.col }
      visible = next
    }
    // line-19 started at row 3; after +4 it lives at logical row 7, two rows
    // past the 5-row screen — inside the shadow.
    expect(anchor.row).toBe(7)
    expect(shadow.below.length).toBe(4)
    const range = { anchor, head: { row: 0, col: 0 } }
    expect(extractShadowedSelection(visible, shadow, range)).toBe(doc.slice(11, 19).join("\n"))
    // Highlight and copy agree: every visible row overlaySelection paints is a
    // line the extraction contains (the overlay sees the same range).
    const painted = overlaySelection(visible, range, 0, 10)
    for (let i = 0; i < painted.length; i++) expect(painted[i]).not.toBe(visible[i])
  })

  it("drops re-revealed rows on a reversed drag instead of extracting them twice", () => {
    // Up 4 (banks 4 rows below), then back down 3: three of those rows are on
    // screen again and must leave the shadow, keeping the composed buffer
    // contiguous.
    let shadow = shiftShadow(EMPTY_SHADOW, screen(15), 2)
    shadow = shiftShadow(shadow, screen(13), 2)
    expect(shadow.below.map((r) => r[0]?.text)).toEqual(doc.slice(16, 20))
    shadow = shiftShadow(shadow, screen(11), -3)
    expect(shadow.above.map((r) => r[0]?.text)).toEqual(doc.slice(11, 14))
    expect(shadow.below.map((r) => r[0]?.text)).toEqual([doc[19]])
    // Composed space stays contiguous: above ++ screen(14) ++ below.
    const range = { anchor: { row: -3, col: 0 }, head: { row: 5, col: 10 } }
    expect(extractShadowedSelection(screen(14), shadow, range)).toBe(doc.slice(11, 20).join("\n"))
  })

  it("caps the shadow and clamps the anchor to what it can still address", () => {
    let shadow = shiftShadow(EMPTY_SHADOW, screen(15), 2, 3)
    shadow = shiftShadow(shadow, screen(13), 2, 3)
    // Cap 3: the far (anchor-end) row is trimmed, not a middle one.
    expect(shadow.below.map((r) => r[0]?.text)).toEqual(doc.slice(16, 19))
    expect(clampRowToShadow(8, 5, shadow)).toBe(7)
    expect(clampRowToShadow(-9, 5, shadow)).toBe(0)
  })
})
