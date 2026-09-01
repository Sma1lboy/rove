import { describe, expect, it } from "vitest"
import { SIDEBAR_WIDTH, sidebarWidthFor } from "../../src/tui/panes/sidebar/view-core.ts"

/**
 * Rail width contract: 24 was a minimum that never grew, so branch names
 * truncated on wide terminals while the middle pane sat idle. The rail now
 * takes a sixth of the terminal, clamped — it must never drop below the
 * owner-set 24 and never crowd the workspace at the top end.
 */
describe("sidebarWidthFor", () => {
  it("stays at the owner minimum for ordinary terminals", () => {
    expect(sidebarWidthFor(80)).toBe(SIDEBAR_WIDTH)
    expect(sidebarWidthFor(120)).toBe(SIDEBAR_WIDTH)
    expect(sidebarWidthFor(143)).toBe(SIDEBAR_WIDTH)
  })

  it("grows past ~144 cols so wide terminals stop truncating branch names", () => {
    expect(sidebarWidthFor(150)).toBe(25)
    expect(sidebarWidthFor(160)).toBe(26)
    expect(sidebarWidthFor(200)).toBe(33)
  })

  it("caps at 40 so the rail never crowds the workspace pane", () => {
    expect(sidebarWidthFor(240)).toBe(40)
    expect(sidebarWidthFor(400)).toBe(40)
  })

  it("never returns below the minimum, even for degenerate widths", () => {
    expect(sidebarWidthFor(0)).toBe(SIDEBAR_WIDTH)
    expect(sidebarWidthFor(10)).toBe(SIDEBAR_WIDTH)
  })

  it("leaves the workspace the majority of the terminal at every width", () => {
    // Mirror host-files-pane.tsx's clamp: a third of what's left, [22, 34].
    const filesPaneWidth = (terminal: number, rail: number): number =>
      Math.max(22, Math.min(34, Math.floor(Math.max(22, terminal - rail) / 3)))
    for (const width of [80, 120, 160, 200, 240, 300]) {
      const rail = sidebarWidthFor(width)
      const workspace = width - rail - filesPaneWidth(width, rail)
      expect(workspace).toBeGreaterThan(width / 3)
      expect(workspace).toBeGreaterThanOrEqual(30)
    }
  })
})
