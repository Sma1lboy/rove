/**
 * Opening files from the pure-TUI FileTree uses ONE reusable File tab.
 * Appending a command tab per file makes browsing a few files permanently
 * grow the tab strip.
 */

import { initialTabs, openEditorTab } from "@sma1lboy/rove-core/tabs/terminal-tabs-core.ts"
import { describe, expect, test } from "vitest"

describe("pure-TUI File tab behavior", () => {
  test("opening another file replaces and focuses the existing File tab", () => {
    let tabs = initialTabs()
    const openFile = (path: string): void => {
      tabs = openEditorTab(tabs, ["nvim", path], path)
    }

    openFile("src/a.ts")
    const fileTabId = tabs.activeId
    openFile("src/b.ts")

    expect(tabs.tabs).toHaveLength(2)
    expect(tabs.activeId).toBe(fileTabId)
    expect(tabs.tabs.find((tab) => tab.id === fileTabId)).toMatchObject({
      kind: "command",
      purpose: "editor",
      title: "src/b.ts",
      command: ["nvim", "src/b.ts"],
    })
  })
})
