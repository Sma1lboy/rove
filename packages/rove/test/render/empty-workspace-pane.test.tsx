/** @jsxImportSource @opentui/react */
import { afterAll, afterEach, describe, expect, it, spyOn } from "bun:test"
import * as engines from "../../src/engine/account-detect"

const available = spyOn(engines, "availableEngineIds").mockResolvedValue(["claude", "codex"])
afterAll(() => available.mockRestore())
import { EmptyWorkspacePane } from "../../src/tui-react/workspace/empty-workspace-pane"
import { resetTabsSyncForTests } from "../../src/tui-react/workspace/tabs-sync"
import { tabsByTask } from "../../src/tui-react/workspace/terminal-tabs-shared"
import { type TabsSyncDaemon, attachTabsDaemon, untilDaemon } from "../tui-react/tabs-sync-daemon"
import { act, renderComponent, settle } from "./harness"

let daemon: TabsSyncDaemon | null = null

afterEach(() => {
  daemon?.detach()
  daemon = null
})

/** The daemon's tabs for `t1`: none (never opened), or KNOWN and empty with the reopen hint the close recorded. */
async function seed(
  path: "emptied" | "never-opened",
  reopenAs?: { kind: "engine"; vendor?: string } | { kind: "command" },
): Promise<TabsSyncDaemon> {
  resetTabsSyncForTests()
  const emptied = { tabs: [], activeId: "tab-1", nextOrdinal: 2, ...(reopenAs ? { reopenAs } : {}) }
  daemon = await attachTabsDaemon(path === "emptied" ? { t1: emptied } : {})
  return daemon
}

const seedEmptied = (reopenAs?: { kind: "engine"; vendor?: string } | { kind: "command" }) => seed("emptied", reopenAs)

const render = (focused = true) =>
  renderComponent(<EmptyWorkspacePane taskId="t1" focused={focused} />, { providers: { dialog: true } })

describe("the no-sessions placeholder's keys", () => {
  it("enter reopens a session — in the daemon's tabs, not just this TUI's view", async () => {
    const { tabs } = await seedEmptied()
    const { mockInput } = await render()
    await act(async () => {
      mockInput.pressEnter()
    })
    await settle()
    expect(tabsByTask.get("t1")?.tabs.length).toBe(1)
    await untilDaemon(() => tabs("t1")?.tabs.length === 1)
    expect(tabs("t1")?.tabs.length).toBe(1)
  })

  it("clicking the hint reopens a session, as enter does", async () => {
    const { tabs } = await seedEmptied()
    const { mockMouse, frame } = await render()
    const rows = (await frame()).split("\n")
    const y = rows.findIndex((row) => row.includes("No sessions here"))
    expect(y).toBeGreaterThanOrEqual(0)
    await act(async () => {
      await mockMouse.click((rows[y] ?? "").indexOf("No sessions here") + 1, y)
    })
    await settle()
    expect(tabsByTask.get("t1")?.tabs.length).toBe(1)
    await untilDaemon(() => tabs("t1")?.tabs.length === 1)
  })

  it("reopens the KIND that was closed, not always an engine", async () => {
    // The close records what went (`reopenAs`); pressing the key here must
    // route through that, or closing a shell and pressing enter drops the
    // user into an engine they never asked for.
    await seedEmptied({ kind: "command" })
    const { mockInput } = await render()
    await act(async () => {
      mockInput.pressEnter()
    })
    await settle()
    expect(tabsByTask.get("t1")?.tabs[0]?.kind).toBe("command")
  })

  it("ctrl+e opens the chooser without starting a tab; cancel leaves it empty", async () => {
    await seedEmptied()
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
    const { tabs } = await seed(path as "emptied" | "never-opened", { kind: "command" })
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
    await untilDaemon(() => tabs("t1")?.tabs.length === 1)
    expect(tabs("t1")?.tabs.map((row) => row.id)).toEqual([tab?.id as string])
  })

  it("ignores the keys while the pane is not focused", async () => {
    // The workspace is one of several panes. An unfocused pane answering
    // enter would steal it from whatever the user is actually typing into.
    const { tabs } = await seedEmptied()
    const { mockInput } = await render(false)
    await act(async () => {
      mockInput.pressEnter()
    })
    await settle()
    expect(tabsByTask.get("t1")?.tabs.length).toBe(0)
    expect(tabs("t1")?.tabs).toEqual([])
  })
})
