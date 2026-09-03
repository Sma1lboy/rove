/**
 * Whole-list lifecycle transitions (`terminal-tabs-lifecycle.ts`): where a
 * task's tab list comes from when there is none, or none that can be used —
 * first mount, a restart snapshot, and the last tab exiting.
 *
 * Kept apart from `terminal-tabs-core.test.ts` (what a user action does to an
 * existing list) for the same reason the source is: these four must AGREE
 * about ordinal minting and carried identity, and reading them together is
 * what makes a divergence obvious.
 */

import { describe, expect, it } from "vitest"
import {
  type EngineTab,
  type TabsState,
  addTab,
  initialTabs,
  openCommandTab,
  openEditorTab,
  recycleTabs,
  rehydrateTabs,
  renameActiveTab,
  setTabAutoTitle,
  setTabSessionId,
  setTabSpawned,
} from "../../src/tui/workspace/terminal-tabs-core"

describe("terminal tabs lifecycle", () => {
  it("starts with one untitled active tab", () => {
    const s = initialTabs()
    expect(s.tabs).toHaveLength(1)
    expect(s.activeId).toBe("tab-1")
    expect(s.tabs[0].title).toBeNull()
  })
  // Why: rehydrateTabs is the restart contract — a tab is a TERMINAL, so
  // every tab survives: engine tabs
  // come back resumable, command tabs (a degraded shell, a dead editor)
  // come back as plain shells. Dropping command tabs reopens a closed
  // shell as claude: a lone degraded tab falls through to
  // initialTabs(), resurrecting a fresh engine in the terminal's place.
  it("rehydrateTabs keeps every tab; command tabs respawn as shells", () => {
    let s = addTab(initialTabs(), "codex") // [1, 2*(codex)]
    s = setTabSessionId(s, "tab-1", "uuid-1")
    s = openEditorTab(s, ["sh", "-c", "nvim x"], "x") // [1, 2, 3*(editor)]
    const back = rehydrateTabs(s, ["/bin/zsh"])
    expect(back.tabs.map((t) => t.id)).toEqual(["tab-1", "tab-2", "tab-3"])
    expect(back.activeId).toBe("tab-3")
    expect(back.tabs[0]).toMatchObject({ kind: "engine", sessionId: "uuid-1" })
    // The editor's process is gone — its terminal comes back as a shell.
    expect(back.tabs[2]).toMatchObject({ kind: "command", command: ["/bin/zsh"] })
    expect(back.tabs[2]).toHaveProperty("purpose", undefined)
    expect(back.nextOrdinal).toBe(s.nextOrdinal)
    // THE reported bug: a single persisted COMMAND tab (a shell pick from
    // an older snapshot) must reopen as that shell, NOT as a fresh engine.
    const shellOnly = rehydrateTabs(
      {
        tabs: [{ kind: "command", id: "tab-1", title: null, ordinal: 1, command: ["/bin/zsh"] }],
        activeId: "tab-1",
        nextOrdinal: 2,
      },
      ["/bin/zsh"],
    )
    expect(shellOnly.tabs).toHaveLength(1)
    expect(shellOnly.tabs[0]).toMatchObject({ kind: "command", id: "tab-1", command: ["/bin/zsh"] })
    // Corrupt/empty snapshot still falls back to a fresh initial state.
    expect(rehydrateTabs({ tabs: [], activeId: "tab-1", nextOrdinal: 1 }, ["/bin/zsh"])).toEqual(initialTabs())
  })
  // Why: a last-tab in-place recycle that reset to bare initialTabs() would
  // drop title/autoTitle — the naming pass would then derive a NEW name from
  // the fresh session's first prompt, so the tab would visibly rename itself
  // on every recycle. Carrying both fields keeps the name stable AND blocks
  // re-derivation (the pass only names tabs with neither field set).
  it("recycleTabs keeps the exited tab's title/autoTitle on the fresh tab", () => {
    let s = setTabAutoTitle(initialTabs(), "tab-1", "fix the resize race")
    s = renameActiveTab(s, "my name")
    const fresh = recycleTabs(s, s.tabs[0])
    expect(fresh.tabs).toHaveLength(1)
    expect(fresh.tabs[0]).toMatchObject({
      kind: "engine",
      title: "my name",
      autoTitle: "fix the resize race",
    })
    // Fresh session: no carried sessionId/spawned from the dead tab.
    expect((fresh.tabs[0] as EngineTab).sessionId).toBeUndefined()
    expect((fresh.tabs[0] as EngineTab).spawned).toBeUndefined()
    // An untitled tab recycles untitled — nothing invented.
    const bare = initialTabs()
    expect(recycleTabs(bare, bare.tabs[0]).tabs[0]).toMatchObject({ title: null })
  })
  // Why: the recycle used to hand back `initialTabs()` wholesale, which
  // dropped the tab's PINNED engine — a tab the user pointed at Codex came
  // back running the TASK's engine while still wearing the Codex
  // conversation's title, so the swap was invisible. `reopenHintFor` already
  // carries `vendor` for the sibling revive path; recycle must too.
  it("recycleTabs carries the exited tab's pinned vendor and engineCommand", () => {
    const s: TabsState = {
      tabs: [{ kind: "engine", id: "tab-3", title: null, ordinal: 3, vendor: "codex", engineCommand: "codex --yolo" }],
      activeId: "tab-3",
      nextOrdinal: 4,
    }
    expect(recycleTabs(s, s.tabs[0]).tabs[0]).toMatchObject({ vendor: "codex", engineCommand: "codex --yolo" })
  })
  // Why: `TabBase.id` is "never reused within a task" — inbox episodes and
  // the orphan-adoption suppression in terminal-tabs-close.ts are both keyed
  // `(taskId, tabId)`. Resetting to `tab-1` handed the recycled tab a dead
  // tab's episodes and its in-flight suppression. `reopenTabs` already
  // consumes `nextOrdinal`; recycle must too.
  it("recycleTabs mints a fresh id from nextOrdinal instead of reusing tab-1", () => {
    let s = initialTabs()
    s = addTab(s) // tab-2
    s = addTab(s) // tab-3
    const recycled = recycleTabs(s, s.tabs[2])
    expect(recycled.tabs[0]?.id).toBe("tab-4")
    expect(recycled.tabs[0]?.ordinal).toBe(4)
    expect(recycled.activeId).toBe("tab-4")
    expect(recycled.nextOrdinal).toBe(5)
    // Never rewinds onto an id this task already handed out.
    for (const used of s.tabs) expect(recycled.tabs[0]?.id).not.toBe(used.id)
  })
})
