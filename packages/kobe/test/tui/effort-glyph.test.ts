/**
 * Effort fill glyph: a level's position in its engine's own list picks the
 * fill, so any level count reads empty → full, and a level the engine does
 * not declare gets no glyph at all.
 */

import { describe, expect, it } from "vitest"
import { effortLabel, effortMark } from "../../src/tui/lib/effort-glyph"

const glyphs = (levels: readonly string[]) => levels.map((level) => effortMark(levels, level)?.glyph)

describe("effortMark", () => {
  it("spreads 3, 4, 5, 6 and 7 levels from empty to full", () => {
    expect(glyphs(["low", "medium", "high"])).toEqual(["○", "◑", "◉"])
    expect(glyphs(["a", "b", "c", "d"])).toEqual(["○", "◑", "◕", "◉"])
    expect(glyphs(["a", "b", "c", "d", "e"])).toEqual(["○", "◔", "◑", "●", "◉"])
    expect(glyphs(["none", "low", "medium", "high", "xhigh", "max"])).toEqual(["○", "◔", "◑", "◕", "●", "◉"])
    expect(glyphs(["off", "minimal", "low", "medium", "high", "xhigh", "max"])).toEqual([
      "○",
      "◔",
      "◑",
      "◑",
      "◕",
      "●",
      "◉",
    ])
  })

  it("gives an undeclared or missing level no glyph", () => {
    expect(effortMark(["low", "high"], "ultra")).toBeNull()
    expect(effortMark(undefined, "high")).toBeNull()
    expect(effortMark(["low", "high"], undefined)).toBeNull()
    expect(effortLabel(["low", "high"], "ultra")).toBe("ultra")
  })

  it("labels a declared level with its glyph", () => {
    expect(effortLabel(["low", "medium", "high"], "medium")).toBe("◑ medium")
  })
})
