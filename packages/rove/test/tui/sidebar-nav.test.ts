import { describe, expect, it } from "vitest"
import { focusPaneForNav } from "../../src/tui/panes/sidebar/nav-core"

describe("sidebar navigation metadata", () => {
  it("a page owns the content pane's focus; the terminal hands it back to the sidebar", () => {
    expect(focusPaneForNav("terminal")).toBe("sidebar")
    expect(focusPaneForNav("kanban.board")).toBe("workspace")
    expect(focusPaneForNav("automations")).toBe("workspace")
  })
})
