import { describe, expect, it } from "vitest"
import { SIDEBAR_NAV_ITEMS, cycleNavTarget, focusPaneForNav } from "../../src/tui/panes/sidebar/nav-core"

describe("sidebar navigation metadata", () => {
  it("maps every visible destination to its live keymap action", () => {
    expect(SIDEBAR_NAV_ITEMS).toEqual([
      { nav: "kanban", labelKey: "tasks.nav.kanban", bindingId: "kanban.open" },
      { nav: "automations", labelKey: "tasks.nav.automations", bindingId: "automations.open" },
    ])
  })

  it("cycles visible destinations and preserves pane focus ownership", () => {
    expect(cycleNavTarget("kanban", 1)).toBe("automations")
    expect(cycleNavTarget("automations", -1)).toBe("kanban")
    expect(cycleNavTarget("terminal", 1)).toBeNull()

    expect(focusPaneForNav("terminal")).toBe("sidebar")
    expect(focusPaneForNav("kanban")).toBe("workspace")
  })
})
