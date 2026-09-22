import { describe, expect, it } from "vitest"
import { charWidth, displayWidth, padEndCells } from "../../src/lib/display-width.ts"

/**
 * Cell-width contract for `charWidth`/`displayWidth`. These feed the
 * `kobe export` table renderer and the embedded-terminal cursor overlay, so an
 * under-counted wide glyph drifts every cell to its right by one column — the
 * exact misalignment the module exists to prevent.
 */
describe("charWidth", () => {
  it("counts CJK ideographs, kana, and fullwidth forms as two cells", () => {
    expect(charWidth("中".codePointAt(0) as number)).toBe(2) // CJK Unified
    expect(charWidth("あ".codePointAt(0) as number)).toBe(2) // Hiragana
    expect(charWidth("Ａ".codePointAt(0) as number)).toBe(2) // Fullwidth A (U+FF21)
    expect(charWidth("한".codePointAt(0) as number)).toBe(2) // precomposed Hangul syllable
  })

  it("counts C0 / DEL / C1 control characters as zero (non-printing)", () => {
    // wcwidth treats controls as non-printing, not one cell. A stray control
    // byte in a task title or exported cell must not advance the column count.
    expect(charWidth(0x00)).toBe(0) // NUL
    expect(charWidth(0x09)).toBe(0) // TAB (C0)
    expect(charWidth(0x1b)).toBe(0) // ESC (C0)
    expect(charWidth(0x1f)).toBe(0) // C0 ceiling
    expect(charWidth(0x7f)).toBe(0) // DEL
    expect(charWidth(0x80)).toBe(0) // C1 floor
    expect(charWidth(0x85)).toBe(0) // NEL (C1)
    expect(charWidth(0x9f)).toBe(0) // C1 ceiling
    expect(charWidth(0x20)).toBe(1) // space — first printable just past C0
    expect(charWidth(0xa0)).toBe(1) // no-break space — first printable past C1
  })

  it("counts combining diacritical / bidi / variation-selector marks as zero", () => {
    expect(charWidth(0x0301)).toBe(0) // combining acute accent
    expect(charWidth(0x200b)).toBe(0) // zero-width space
    expect(charWidth(0xfe0f)).toBe(0) // variation selector-16
    expect(charWidth(0xfeff)).toBe(0) // BOM / zero-width no-break space
  })
})

describe("displayWidth", () => {
  it("sums cells across a mixed CJK / ASCII string", () => {
    expect(displayWidth("ab中c")).toBe(5) // 1 + 1 + 2 + 1
    expect(displayWidth("你好, world")).toBe(11) // 2 + 2 + rest ASCII (7)
  })

  it("measures decomposed (NFD) Hangul the same as precomposed", () => {
    // macOS filenames arrive NFD-decomposed; a Korean name in the file tree
    // or `kobe export` table must occupy the same width either way.
    const precomposed = "한글" // U+D55C U+AE00
    const decomposed = precomposed.normalize("NFD")
    expect(decomposed.length).toBeGreaterThan(precomposed.length) // genuinely decomposed
    expect(displayWidth(precomposed)).toBe(4)
    expect(displayWidth(decomposed)).toBe(4)
  })

  it("measures decomposed (NFD) voiced kana the same as precomposed", () => {
    // Same macOS-NFD case as Hangul: a Japanese filename with voiced kana
    // (が ぱ) must occupy its precomposed width, not gain a cell per mark.
    const precomposed = "がぱ" // U+304C U+3071
    const decomposed = precomposed.normalize("NFD") // か+U+3099, は+U+309A
    expect(decomposed.length).toBeGreaterThan(precomposed.length) // genuinely decomposed
    expect(displayWidth(precomposed)).toBe(4)
    expect(displayWidth(decomposed)).toBe(4)
  })

  it("does not count a combining half mark as an extra cell", () => {
    expect(displayWidth("a︦")).toBe(1) // base glyph + zero-width mark
  })

  it("does not count control characters toward a string's cell width", () => {
    // A stray control byte occupies no columns; only the visible glyphs do.
    // (This zeroes the control code point itself, not a full ANSI sequence —
    // the printable `[0m` tail of an escape still measures normally.)
    expect(displayWidth("a\x1bb")).toBe(2) // ESC between two glyphs adds nothing
    expect(displayWidth("a\x00b")).toBe(2) // NUL between two glyphs adds nothing
    expect(displayWidth("\x07中")).toBe(2) // BEL is free; the wide glyph is 2
    expect(displayWidth("a\x1b\u0301b")).toBe(2) // control + combining mark: both zero
  })

  it("counts an astral character once, not as two UTF-16 units", () => {
    const ext = "𠀀" // U+20000, one wide code point stored as a surrogate pair
    expect(ext.length).toBe(2) // two UTF-16 units
    expect(displayWidth(ext)).toBe(2) // still two cells, not four
  })

  it("sums wide enclosed-ideograph glyphs over code points, not UTF-16 units", () => {
    expect(displayWidth("🈚x")).toBe(3) // wide (2) + ascii (1)
    expect(displayWidth("🀄🃏")).toBe(4)
  })
})

/**
 * `padEndCells` — the cell-based `String.padEnd`. Callers align columnar
 * text (welcome-pane key caps); plain padEnd counts UTF-16 units, so a wide
 * glyph under-pads and every column to its right drifts.
 */
describe("padEndCells", () => {
  it("pads a wide CJK string by cells, not code units", () => {
    expect(padEndCells("中文", 6)).toBe("中文  ") // 4 cells + 2 spaces
    expect(padEndCells("中文", 4)).toBe("中文") // already at target
  })
})
