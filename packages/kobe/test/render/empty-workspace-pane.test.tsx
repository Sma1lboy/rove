/** @jsxImportSource @opentui/react */
/**
 * The keys the no-sessions placeholder advertises (issue #90).
 *
 * The copy has always read "press ⏎ or ctrl+e to start one", and neither key
 * did anything: both are registered inside `TerminalTabs`, which this state
 * deliberately does NOT mount (its `active` tab is non-null by construction,
 * so mounting over an empty list would mint a replacement and the close would
 * never appear to take). The placeholder named an affordance nothing backed.
 *
 * So the pane binds them itself, and these pin that: a press REVIVES the
 * task's tabs. Asserting on `tabsByTask` rather than the frame is deliberate —
 * the revive is a write to that module map, and the frame after it would show
 * TerminalTabs, which opens a daemon socket.
 */

import { describe, expect, it } from "bun:test"
import { EmptyWorkspacePane } from "../../src/tui-react/workspace/empty-workspace-pane"
import { tabsByTask } from "../../src/tui-react/workspace/terminal-tabs-shared"
import { act, renderComponent, settle } from "./harness"

/** A task whose last tab was closed: KNOWN, empty, with the reopen hint the close recorded. */
function seedEmptied(reopenAs?: { kind: "engine"; vendor?: string } | { kind: "command" }): void {
  tabsByTask.clear()
  tabsByTask.set("t1", {
    tabs: [],
    activeId: "tab-1",
    nextOrdinal: 2,
    ...(reopenAs ? { reopenAs } : {}),
  } as never)
}

const render = (focused = true) => renderComponent(<EmptyWorkspacePane taskId="t1" focused={focused} />)

describe("the no-sessions placeholder's keys", () => {
  it("says which keys to press", async () => {
    seedEmptied()
    const { frame } = await render()
    expect(await frame()).toContain("No sessions here")
  })

  it("enter reopens a session", async () => {
    seedEmptied()
    const { mockInput } = await render()
    await act(async () => {
      mockInput.pressEnter()
    })
    await settle()
    expect(tabsByTask.get("t1")?.tabs.length).toBe(1)
  })

  it("ctrl+e reopens a session too", async () => {
    seedEmptied()
    const { mockInput } = await render()
    await act(async () => {
      mockInput.pressKey("e", { ctrl: true })
    })
    await settle()
    expect(tabsByTask.get("t1")?.tabs.length).toBe(1)
  })

  it("reopens the KIND that was closed, not always an engine", async () => {
    // The close records what went (`reopenAs`); pressing the key here must
    // route through that, or closing a shell and pressing enter drops the
    // user into an engine they never asked for.
    seedEmptied({ kind: "command" })
    const { mockInput } = await render()
    await act(async () => {
      mockInput.pressEnter()
    })
    await settle()
    expect(tabsByTask.get("t1")?.tabs[0]?.kind).toBe("command")
  })

  it("ignores the keys while the pane is not focused", async () => {
    // The workspace is one of several panes. An unfocused pane answering
    // enter would steal it from whatever the user is actually typing into.
    seedEmptied()
    const { mockInput } = await render(false)
    await act(async () => {
      mockInput.pressEnter()
    })
    await settle()
    expect(tabsByTask.get("t1")?.tabs.length).toBe(0)
  })
})
