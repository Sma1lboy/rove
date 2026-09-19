import { describe, expect, it } from "vitest"
import {
  MIN_WORKSPACE_WIDTH,
  SIDEBAR_WIDTH,
  resolveSidebarWidth,
  sidebarWidthFor,
} from "../../src/tui/panes/sidebar/view-core.ts"

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

/**
 * A dragged width is an OVERRIDE of the derived one, not a replacement. The
 * cases below are the ones that decide whether a pin is a feature or a trap:
 * a pin that outlives a narrow terminal, and a pin you can get rid of.
 */
describe("resolveSidebarWidth", () => {
  it("follows the terminal when nothing is pinned", () => {
    expect(resolveSidebarWidth(120, null)).toBe(sidebarWidthFor(120))
    expect(resolveSidebarWidth(200, null)).toBe(sidebarWidthFor(200))
  })

  it("honours a pin, including widths the derived rule would never produce", () => {
    // Past the derived cap of 40 — the whole point of dragging it yourself.
    expect(resolveSidebarWidth(200, 60)).toBe(60)
    expect(resolveSidebarWidth(200, 28)).toBe(28)
  })

  it("squeezes a pin that no longer fits, and pays it back when it does", () => {
    // Same pin, three terminal widths: the stored value never changes, so
    // shrinking the window and restoring it restores the rail too.
    expect(resolveSidebarWidth(200, 60)).toBe(60)
    expect(resolveSidebarWidth(90, 60)).toBe(50)
    expect(resolveSidebarWidth(200, 60)).toBe(60)
  })

  it("never lets a pin starve the workspace or undercut the minimum", () => {
    expect(resolveSidebarWidth(200, 500)).toBe(200 - MIN_WORKSPACE_WIDTH)
    expect(resolveSidebarWidth(200, 2)).toBe(SIDEBAR_WIDTH)
    // Terminal too narrow to give the workspace its floor: the rail keeps its
    // own minimum rather than collapsing to nothing.
    expect(resolveSidebarWidth(50, 40)).toBe(SIDEBAR_WIDTH)
  })

  it("clearing the pin returns the derived width, whatever was pinned", () => {
    expect(resolveSidebarWidth(200, null)).toBe(33)
    expect(resolveSidebarWidth(160, null)).toBe(26)
  })

  it("rounds a fractional pin rather than rendering a fractional column", () => {
    expect(resolveSidebarWidth(200, 30.4)).toBe(30)
    expect(resolveSidebarWidth(200, 30.6)).toBe(31)
  })
})
