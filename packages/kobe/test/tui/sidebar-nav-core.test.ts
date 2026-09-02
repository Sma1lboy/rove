import { describe, expect, test } from "vitest"
import { SIDEBAR_NAV_ITEMS, cycleNavTarget, focusPaneForNav } from "../../src/tui/panes/sidebar/nav-core"

// The full rail contract (order, binding ids, cycling) lives in
// sidebar-nav.test.ts; this file pins only what Agent Topology adds.
describe("sidebar navigation core: Agent Topology row", () => {
  test("is the last rail destination so prefix+1/2/3 keep their rows", () => {
    expect(SIDEBAR_NAV_ITEMS.at(-1)).toEqual({ nav: "agents", labelKey: "tasks.nav.agents", bindingId: "agents.open" })
    expect(SIDEBAR_NAV_ITEMS.some((item) => item.nav === "terminal")).toBe(false)
  })

  test("cycles like any other rail row", () => {
    expect(cycleNavTarget("agents", 1)).toBe("kanban")
    expect(cycleNavTarget("agents", -1)).toBe("issues")
    expect(cycleNavTarget("terminal", 1)).toBeNull()
  })

  test("moves into workspace focus like the other rail pages", () => {
    expect(focusPaneForNav("agents")).toBe("workspace")
    expect(focusPaneForNav("terminal")).toBe("sidebar")
  })
})
