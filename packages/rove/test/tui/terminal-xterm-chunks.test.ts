import { describe, expect, test } from "vitest"
import { xtermLineToChunks } from "../../src/tui/panes/terminal/xterm-chunks"

function makeCell(chars: string): {
  getChars(): string
  getWidth(): number
  isFgDefault(): boolean
  isBgDefault(): boolean
  isFgPalette(): boolean
  isBgPalette(): boolean
  isFgRGB(): boolean
  isBgRGB(): boolean
  getFgColorMode(): number
  getBgColorMode(): number
  getFgColor(): number
  getBgColor(): number
  isAttributeDefault(): boolean
  isBold(): boolean
  isDim(): boolean
  isItalic(): boolean
  isUnderline(): boolean
  isBlink(): boolean
  isInverse(): boolean
  isInvisible(): boolean
  isStrikethrough(): boolean
} {
  return {
    getChars: () => chars,
    getWidth: () => 1,
    isFgDefault: () => true,
    isBgDefault: () => true,
    isFgPalette: () => false,
    isBgPalette: () => false,
    isFgRGB: () => false,
    isBgRGB: () => false,
    getFgColorMode: () => 0,
    getBgColorMode: () => 0,
    getFgColor: () => 0,
    getBgColor: () => 0,
    isAttributeDefault: () => true,
    isBold: () => false,
    isDim: () => false,
    isItalic: () => false,
    isUnderline: () => false,
    isBlink: () => false,
    isInverse: () => false,
    isInvisible: () => false,
    isStrikethrough: () => false,
  }
}

// A row of `length` cells: `text` occupies the leading columns, the rest are
// blank (default) cells — the same shape xterm hands us for a partially filled
// line (a prompt followed by trailing whitespace up to the cursor).
function makeLine(text: string, length: number) {
  const glyphs = [...text]
  return {
    length,
    getCell: (i: number) => (i < glyphs.length ? makeCell(glyphs[i] as string) : makeCell(" ")),
  }
}

function rowText(chunks: ReturnType<typeof xtermLineToChunks>): string {
  return chunks.map((c) => c.text).join("")
}

describe("xtermLineToChunks", () => {
  test("an all-blank line collapses to no chunks", () => {
    const chunks = xtermLineToChunks(makeLine("", 80))
    expect(chunks).toHaveLength(0)
  })

  test("the floor never shrinks a row that already extends past it", () => {
    const chunks = xtermLineToChunks(makeLine("hello world", 80), 4)
    expect(rowText(chunks)).toBe("hello world")
  })
})
