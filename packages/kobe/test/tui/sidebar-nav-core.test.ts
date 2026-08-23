import { describe, expect, test } from "vitest"
import { SIDEBAR_NAV_ITEMS, cycleNavTarget, focusPaneForNav } from "../../src/tui/panes/sidebar/nav-core"

describe("sidebar navigation core", () => {
  test("declares Agent Tree as the first rail destination", () => {
    expect(SIDEBAR_NAV_ITEMS.map((item) => item.nav)).toEqual(["agents", "kanban", "automations"])
    expect(SIDEBAR_NAV_ITEMS.some((item) => item.nav === "terminal")).toBe(false)
  })

  test("cycles through every visible rail destination", () => {
    expect(cycleNavTarget("agents", 1)).toBe("kanban")
    expect(cycleNavTarget("kanban", 1)).toBe("automations")
    expect(cycleNavTarget("automations", 1)).toBe("agents")
    expect(cycleNavTarget("agents", -1)).toBe("automations")
    expect(cycleNavTarget("terminal", 1)).toBeNull()
    expect(cycleNavTarget("issues", 1)).toBeNull()
  })

  test("moves rail pages into workspace focus", () => {
    expect(focusPaneForNav("agents")).toBe("workspace")
    expect(focusPaneForNav("kanban")).toBe("workspace")
    expect(focusPaneForNav("automations")).toBe("workspace")
    expect(focusPaneForNav("issues")).toBe("workspace")
    expect(focusPaneForNav("terminal")).toBe("sidebar")
  })
})
