import {
  NARROW_BREAKPOINT,
  isNarrowWidth,
  narrowSurface,
  setNarrowBreakpoint,
} from "@sma1lboy/rove-core/lib/narrow-mode.ts"
import { afterEach, describe, expect, it } from "vitest"

describe("isNarrowWidth", () => {
  afterEach(() => setNarrowBreakpoint(undefined))

  it("is exclusive at the breakpoint: 70 cols keeps the desktop layout", () => {
    expect(isNarrowWidth(NARROW_BREAKPOINT)).toBe(false)
    expect(isNarrowWidth(NARROW_BREAKPOINT - 1)).toBe(true)
  })

  it("follows layout.narrowBelow: a split pane can ask for one panel at 100 cols", () => {
    setNarrowBreakpoint(120)
    expect(isNarrowWidth(100)).toBe(true)
    expect(isNarrowWidth(120)).toBe(false)
  })

  it("0 keeps the desktop layout at any width", () => {
    setNarrowBreakpoint(0)
    expect(isNarrowWidth(1)).toBe(false)
  })

  it("an unreadable value falls back to 70, a negative one clamps to 0", () => {
    setNarrowBreakpoint("wide")
    expect(isNarrowWidth(69)).toBe(true)
    expect(isNarrowWidth(70)).toBe(false)
    setNarrowBreakpoint(-5)
    expect(isNarrowWidth(1)).toBe(false)
  })
})

describe("narrowSurface", () => {
  it("sidebar focus always shows the list — ctrl+q's back gesture", () => {
    expect(narrowSurface({ focusedPane: "sidebar", hasSelection: true, hasOpenPage: false })).toBe("sidebar")
    expect(narrowSurface({ focusedPane: "sidebar", hasSelection: true, hasOpenPage: true })).toBe("sidebar")
  })

  it("entering a task shows the workspace full-screen", () => {
    expect(narrowSurface({ focusedPane: "workspace", hasSelection: true, hasOpenPage: false })).toBe("content")
  })

  it("an open rail page shows even with no task selected", () => {
    expect(narrowSurface({ focusedPane: "workspace", hasSelection: false, hasOpenPage: true })).toBe("content")
  })

  it("nothing to show falls back to the sidebar", () => {
    expect(narrowSurface({ focusedPane: "workspace", hasSelection: false, hasOpenPage: false })).toBe("sidebar")
    expect(narrowSurface({ focusedPane: "files", hasSelection: false, hasOpenPage: false })).toBe("sidebar")
  })
})
