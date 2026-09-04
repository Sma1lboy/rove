import { describe, expect, it } from "vitest"

import { approxCellWidth } from "../../src/lib/display-width"
import { spacedTitle, truncateTitle } from "../../src/tui/panes/sidebar/labels"

describe("sidebar row labels", () => {
  it("keeps the glyph-to-title spacer inside the label", () => {
    expect(spacedTitle("kobe", 12)).toBe(" kobe")
  })

  it("preserves the spacer when the title is ellipsised", () => {
    expect(spacedTitle("delta_project", 6)).toBe(" delta…")
  })

  it("does not bake spacing into plain title truncation", () => {
    expect(truncateTitle("delta_project", 6)).toBe("delta…")
  })

  /**
   * `max` is a CELL budget — every caller sizes it with `approxCellWidth` —
   * so a wide title must be spent in the same unit it was measured in. A
   * code-point truncator reads these 6 glyphs as fitting a 6 budget and
   * returns all 12 cells of them, drawing through the box that was sized
   * for 6.
   */
  it("spends a CJK title against cells, not code points", () => {
    const title = "终端渲染说明"
    expect([...title].length).toBe(6)
    expect(approxCellWidth(title)).toBe(12)
    expect(approxCellWidth(truncateTitle(title, 6))).toBeLessThanOrEqual(6)
    expect(truncateTitle(title, 6)).toBe("终端…")
  })
})
