import { describe, expect, it } from "vitest"
import { resolveSidebarHoverTooltipLayout } from "../../src/tui/panes/sidebar/hover-layout"

describe("sidebar hover tooltip layout", () => {
  it("clamps the tooltip inside the screen", () => {
    const layout = resolveSidebarHoverTooltipLayout({
      hoverX: 78,
      hoverY: 22,
      screenWidth: 80,
      screenHeight: 24,
      lines: [{ text: "a long hovered task title" }, { text: "/tmp/repo/worktree", dim: true }],
    })
    expect(layout.left + layout.boxWidth).toBeLessThan(80)
    expect(layout.top + layout.boxHeight).toBeLessThan(24)
  })
})
