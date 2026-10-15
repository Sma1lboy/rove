/**
 * Adoption: a live pty session the tab state doesn't list becomes a real tab
 * under its own id, so the sidebar's ⚠ row turns into one the user can open
 * and close.
 */

import { describe, expect, it } from "vitest"
import { initialSplit, splitActive } from "../../src/tui/workspace/split-core"
import { absorbTab, adoptTabs } from "../../src/tui/workspace/tabs-adopt"
import { initialTabs } from "../../src/tui/workspace/terminal-tabs-core"

describe("adoptTabs", () => {
  it("adopts the live session's own tab id without disturbing the active tab", () => {
    const next = adoptTabs({ tabs: initialTabs().tabs, activeId: "tab-1", nextOrdinal: 2 }, ["tab-6"])
    expect(next.activeId).toBe("tab-1")
    // Its own id + implied ordinal: the key the host runs it under, and the
    // ordinal the strip labels it by. A minted one would rename the session.
    expect(next.tabs.find((tab) => tab.id === "tab-6")).toMatchObject({ ordinal: 6, spawned: true })
    // Past every adopted ordinal, so the next new tab cannot collide.
    expect(next.nextOrdinal).toBe(7)
  })
})

describe("absorbTab", () => {
  const shell = { kind: "command", id: "tab-3", title: null, ordinal: 3, command: ["/bin/sh"] } as const

  it("appends a CLI-created tab, raises nextOrdinal past it and leaves the active tab alone", () => {
    const next = absorbTab({ tabs: initialTabs().tabs, activeId: "tab-1", nextOrdinal: 2 }, shell)
    expect(next.tabs.map((t) => t.id)).toEqual(["tab-1", "tab-3"])
    expect(next.activeId).toBe("tab-1")
    expect(next.nextOrdinal).toBe(4)
  })

  it("replaces the orphan poll's engine guess for the same id, and is a no-op once the row is held", () => {
    const guessed = adoptTabs({ tabs: initialTabs().tabs, activeId: "tab-1", nextOrdinal: 2 }, ["tab-3"])
    const fixed = absorbTab(guessed, shell)
    expect(fixed.tabs.find((t) => t.id === "tab-3")).toEqual(shell)
    expect(absorbTab(fixed, shell)).toBe(fixed)
  })

  it("takes a split tree the CLI wrote (tab-split), then the null it wrote when the tab unsplit", () => {
    const held = absorbTab({ tabs: initialTabs().tabs, activeId: "tab-1", nextOrdinal: 2 }, shell)
    const tree = splitActive(initialSplit<readonly string[] | null>(null), "row", ["/bin/sh"], null)
    const split = absorbTab(held, { ...shell, splitTree: tree })
    expect(split.tabs.find((t) => t.id === "tab-3")?.splitTree).toBe(tree)
    // A stale TUI copy must not keep a tree the CLI removed, or its next write would resurrect the pane.
    const back = absorbTab(split, { ...shell, splitTree: null })
    expect(back.tabs.find((t) => t.id === "tab-3")?.splitTree).toBeNull()
  })
})
