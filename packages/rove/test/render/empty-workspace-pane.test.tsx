/** @jsxImportSource @opentui/react */
import { afterAll, describe, expect, it, spyOn } from "bun:test"
import * as engines from "../../src/engine/account-detect"

const available = spyOn(engines, "availableEngineIds").mockResolvedValue(["claude", "codex"])
afterAll(() => available.mockRestore())
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

const render = (focused = true) =>
  renderComponent(<EmptyWorkspacePane taskId="t1" focused={focused} />, { providers: { dialog: true } })

describe("the no-sessions placeholder's keys", () => {
  it("enter reopens a session", async () => {
    seedEmptied()
    const { mockInput } = await render()
    await act(async () => {
      mockInput.pressEnter()
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

  it("ctrl+e opens the chooser without starting a tab; cancel leaves it empty", async () => {
    seedEmptied()
    const { mockInput, frame } = await render()
    await act(async () => {
      mockInput.pressKey("e", { ctrl: true })
    })
    await settle()
    expect(await frame()).toContain("New conversation")
    expect(tabsByTask.get("t1")?.tabs).toHaveLength(0)
    await act(async () => {
      mockInput.pressEscape()
    })
    await settle()
    expect(tabsByTask.get("t1")?.tabs).toHaveLength(0)
  })

  it.each(["emptied", "never-opened"])("a %s task starts with the chosen non-default engine", async (path) => {
    if (path === "emptied") seedEmptied({ kind: "command" })
    else tabsByTask.clear()
    const { mockInput, frame } = await render()
    await act(async () => {
      mockInput.pressKey("e", { ctrl: true })
    })
    await settle()
    expect(await frame()).toContain("New conversation")
    await act(async () => {
      mockInput.pressArrow("right")
    })
    await settle()
    await act(async () => {
      mockInput.pressEnter()
    })
    await settle()
    const tab = tabsByTask.get("t1")?.tabs[0]
    expect(tab?.kind).toBe("engine")
    if (tab?.kind === "engine") {
      expect(tab.vendor).toBe("codex")
      expect(tab.engineCommand).toBe(tab.vendor)
    }
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
