import { describe, expect, test } from "bun:test"
import { type PanelPush, applyPlan, planPanelPush } from "../src/panel-contract.ts"
import {
  MAX_FRAMES,
  MAX_TABS,
  type PanelItem,
  type TaskPanel,
  activate,
  allTabs,
  browserUrl,
  closeOthers,
  closeTab,
  findTab,
  launch,
  loadPanels,
  mountedTabs,
  moveTab,
  navigate,
  newBrowser,
  newFiles,
  newPanel,
  parsePanel,
  setRatio,
  showBrowser,
  showDiff,
  showKind,
  shownKind,
  stepBrowser,
} from "../src/panel-model.ts"

const ids = (panel: TaskPanel, group: "top" | "bottom" = "top") =>
  (group === "top" ? panel.top : panel.bottom)?.tabs.map((tab) => tab.id) ?? []
const current = (panel: TaskPanel, group: "top" | "bottom" = "top") =>
  (group === "top" ? panel.top : panel.bottom)?.active
const diffs = (panel: TaskPanel) => allTabs(panel).filter((tab) => tab.kind === "diff")

describe("opening and finding tabs", () => {
  test("a file's diff has one tab: asking again shows it, with the scope asked for", () => {
    let panel = showDiff(newPanel(), "src/a.ts", "working")
    panel = showDiff(activate(panel, "t1"), "src/a.ts", "branch")
    expect(diffs(panel)).toEqual([{ id: "t2", kind: "diff", path: "src/a.ts", scope: "branch" }])
    expect(current(panel)).toBe("t2")
  })

  test("a different file opens a second tab; the whole worktree is its own", () => {
    const panel = showDiff(showDiff(showDiff(newPanel(), "a.ts", "working"), "b.ts", "working"), ".", "working")
    expect(diffs(panel).map((tab) => tab.kind === "diff" && tab.path)).toEqual(["a.ts", "b.ts", "."])
  })

  test("an address shows the tab already on it, else fills a blank Browser, else opens one", () => {
    const first = showBrowser(newPanel(), "https://a.test/")
    expect(allTabs(first).filter((tab) => tab.kind === "browser")).toHaveLength(1)

    const again = showBrowser(activate(first, "t1"), "https://a.test/")
    expect(allTabs(again)).toHaveLength(2)
    expect(current(again)).toBe("t2")

    const blank = newBrowser(newPanel(), "top")
    const filled = showBrowser(blank, "https://b.test/")
    expect(allTabs(filled)).toHaveLength(2)
    expect(browserUrl(findTab(filled, "t2")?.tab as Extract<PanelItem, { kind: "browser" }>)).toBe("https://b.test/")

    const other = showBrowser(first, "https://c.test/")
    expect(allTabs(other).filter((tab) => tab.kind === "browser")).toHaveLength(2)
  })

  test("a kind alone shows its latest tab; Diff with none opens the whole worktree", () => {
    const two = newFiles(newPanel(), "top")
    expect(current(showKind(activate(two, "t1"), "files"))).toBe("t1")
    expect(current(showKind(two, "files"))).toBe("t2")
    const diff = showKind(newPanel(), "diff")
    expect(diffs(diff)).toEqual([{ id: "t2", kind: "diff", path: ".", scope: "working" }])
  })

  test("a launcher button opens the panel on its kind's latest tab, creating one when there is none", () => {
    const files = launch(newPanel(), false, "files")
    expect(files).toEqual({ panel: newPanel(), open: true })
    const browser = launch(files.panel, true, "browser")
    expect(browser.open).toBe(true)
    expect(shownKind(browser.panel)).toBe("browser")
    expect(launch(files.panel, false, "diff").panel.top.tabs.at(-1)).toMatchObject({ kind: "diff", path: "." })
  })

  test("pressing the button of the kind on screen closes the panel and keeps the tabs; another kind switches", () => {
    const panel = showKind(showKind(newPanel(), "browser"), "files")
    expect(launch(panel, true, "files")).toEqual({ panel, open: false })
    const switched = launch(panel, true, "browser")
    expect(switched.open).toBe(true)
    expect(shownKind(switched.panel)).toBe("browser")
  })

  test("with the panel split, the kind shown last is the one that is on", () => {
    let panel = moveTab(showKind(newPanel(), "browser"), "t2", "bottom")
    expect(shownKind(panel)).toBe("browser")
    panel = activate(panel, "t1")
    expect(shownKind(panel)).toBe("files")
  })

  test("a new diff joins the group that already holds diffs, not the one last touched", () => {
    let panel = showDiff(newPanel(), "a.ts", "working")
    panel = moveTab(panel, "t2", "bottom")
    panel = activate(panel, "t1")
    panel = showDiff(panel, "b.ts", "working")
    expect(ids(panel, "bottom")).toEqual(["t2", "t3"])
  })

  test("past the tab limit the least recently shown tab that is not on screen closes", () => {
    let panel = newPanel()
    for (let n = 0; n < MAX_TABS + 2; n++) panel = showDiff(panel, `f${n}.ts`, "working")
    const kept = allTabs(panel)
    expect(kept).toHaveLength(MAX_TABS)
    expect(kept.some((tab) => tab.kind === "diff" && tab.path === `f${MAX_TABS + 1}.ts`)).toBe(true)
    expect(kept.some((tab) => tab.kind === "diff" && tab.path === "f0.ts")).toBe(false)
  })
})

describe("a Browser tab's own history", () => {
  test("typing after going back drops the forward entries", () => {
    let panel = newBrowser(newPanel(), "top")
    for (const url of ["https://a.test/", "https://b.test/", "https://c.test/"]) panel = navigate(panel, "t2", url)
    panel = stepBrowser(panel, "t2", 0)
    panel = navigate(panel, "t2", "https://d.test/")
    const tab = findTab(panel, "t2")?.tab
    expect(tab).toMatchObject({ urls: ["https://a.test/", "https://d.test/"], at: 1 })
  })

  test("stepping outside the history does nothing", () => {
    const panel = navigate(newBrowser(newPanel(), "top"), "t2", "https://a.test/")
    expect(stepBrowser(panel, "t2", 1)).toBe(panel)
    expect(stepBrowser(panel, "t2", -1)).toBe(panel)
  })
})

describe("closing", () => {
  test("the tab shown before the closed one comes back", () => {
    let panel = newFiles(newPanel(), "top")
    panel = showDiff(panel, "a.ts", "working")
    panel = activate(panel, "t1")
    panel = activate(panel, "t3")
    expect(current(closeTab(panel, "t3"))).toBe("t1")
  })

  test("closing the last tab of the bottom group collapses the split", () => {
    let panel = moveTab(showDiff(newPanel(), "a.ts", "working"), "t2", "bottom")
    expect(panel.bottom).not.toBeNull()
    panel = closeTab(panel, "t2")
    expect(panel.bottom).toBeNull()
    expect(ids(panel)).toEqual(["t1"])
  })

  test("closing the last tab of the top group lifts the bottom one into its place", () => {
    let panel = moveTab(showDiff(newPanel(), "a.ts", "working"), "t2", "bottom")
    panel = closeTab(panel, "t1")
    expect(panel.bottom).toBeNull()
    expect(ids(panel)).toEqual(["t2"])
    expect(current(panel)).toBe("t2")
  })

  test("closing the only tab leaves an empty panel that opens again", () => {
    const empty = closeTab(newPanel(), "t1")
    expect(allTabs(empty)).toEqual([])
    expect(allTabs(showKind(empty, "files"))).toHaveLength(1)
  })

  test("close others keeps the one tab", () => {
    const panel = closeOthers(showDiff(newFiles(newPanel(), "top"), "a.ts", "working"), "t2")
    expect(ids(panel)).toEqual(["t2"])
  })
})

describe("splitting and moving", () => {
  const two = () => showDiff(newPanel(), "a.ts", "working")

  test("moving a tab to the bottom splits; it is the bottom group's active tab and the focus", () => {
    const panel = moveTab(two(), "t2", "bottom")
    expect(ids(panel)).toEqual(["t1"])
    expect(ids(panel, "bottom")).toEqual(["t2"])
    expect(current(panel, "bottom")).toBe("t2")
    expect(panel.focus).toBe("bottom")
  })

  test("moving the only tab to the bottom leaves one group, not an empty top", () => {
    const panel = moveTab(newPanel(), "t1", "bottom")
    expect(panel.bottom).toBeNull()
    expect(ids(panel)).toEqual(["t1"])
  })

  test("a tab dropped before another lands there, in its own group or the other", () => {
    let panel = newFiles(two(), "top")
    panel = moveTab(panel, "t3", "top", 0)
    expect(ids(panel)).toEqual(["t3", "t1", "t2"])
    panel = moveTab(panel, "t3", "top", 3)
    expect(ids(panel)).toEqual(["t1", "t2", "t3"])
    panel = moveTab(panel, "t1", "bottom")
    panel = moveTab(panel, "t3", "bottom", 0)
    expect(ids(panel, "bottom")).toEqual(["t3", "t1"])
    expect(ids(panel)).toEqual(["t2"])
  })

  test("the source group shows what it showed before when its shown tab leaves", () => {
    let panel = newFiles(two(), "top")
    panel = activate(activate(panel, "t1"), "t3")
    panel = moveTab(panel, "t3", "bottom")
    expect(current(panel)).toBe("t1")
  })

  test("the divider keeps each group a fifth of the panel at least", () => {
    expect(setRatio(newPanel(), 0.01).ratio).toBe(0.2)
    expect(setRatio(newPanel(), 0.99).ratio).toBe(0.8)
  })

  test("views render in creation order whatever the tab order", () => {
    const panel = moveTab(newFiles(two(), "top"), "t3", "top", 0)
    expect(allTabs(panel).map((tab) => tab.id)).toEqual(["t1", "t2", "t3"])
  })
})

describe("which views stay mounted", () => {
  const browsers = (n: number) => {
    let panel = newPanel()
    for (let i = 0; i < n; i++) panel = showBrowser(panel, `https://${i}.test/`)
    return allTabs(panel)
  }

  test("past the cap the least recently shown Browser frames go; Files and diffs stay", () => {
    const tabs = browsers(MAX_FRAMES + 2)
    let mounted: string[] = []
    for (const tab of tabs) mounted = mountedTabs(mounted, [tab.id], tabs)
    expect(mounted.filter((id) => id !== "t1")).toHaveLength(MAX_FRAMES)
    expect(mounted).not.toContain("t2")
    expect(mounted).toContain(tabs.at(-1)?.id as string)
  })

  test("a Browser on screen is never dropped, even when both groups show one", () => {
    const tabs = browsers(MAX_FRAMES + 3)
    const mounted = mountedTabs(
      tabs.slice(1).map((tab) => tab.id),
      [tabs[1]?.id as string, tabs[2]?.id as string],
      tabs,
    )
    expect(mounted).toContain(tabs[1]?.id as string)
    expect(mounted).toContain(tabs[2]?.id as string)
  })

  test("a closed tab is unmounted", () => {
    const tabs = allTabs(newPanel())
    expect(mountedTabs(["t1", "t9"], ["t1"], tabs)).toEqual(["t1"])
  })
})

describe("what is stored", () => {
  test("a panel survives a round trip", () => {
    let panel = moveTab(showDiff(showBrowser(newPanel(), "https://a.test/"), "a.ts", "branch"), "t3", "bottom")
    panel = setRatio(panel, 0.3)
    expect(parsePanel(JSON.parse(JSON.stringify(panel)))).toEqual(panel)
  })

  test("damaged entries are dropped, and ids never repeat after a load", () => {
    const parsed = parsePanel({
      top: {
        tabs: [
          { id: "t4", kind: "files" },
          { id: "t4", kind: "files" },
          { id: "x", kind: "files" },
          { id: "t5", kind: "pdf" },
        ],
        active: "gone",
      },
      bottom: { tabs: [] },
      ratio: "wide",
      next: 1,
    })
    expect(parsed && ids(parsed)).toEqual(["t4"])
    expect(parsed?.top.active).toBe("t4")
    expect(parsed?.bottom).toBeNull()
    expect(parsed?.next).toBeGreaterThan(4)
    expect(parsePanel("nope")).toBeNull()
    expect(parsePanel({ top: "x" })).toBeNull()
  })
})

describe("migrating what the panel used to remember", () => {
  const legacy = (tab: Record<string, string>, url: Record<string, string>) => ({
    tab: JSON.stringify(tab),
    url: JSON.stringify(url),
  })

  test("a task's last address becomes a Browser tab, and the old view stays the shown one", () => {
    const loaded = loadPanels(
      null,
      legacy({ T1: "browser", T2: "files" }, { T1: "https://a.test/", T2: "https://b.test/" }),
    )
    const t1 = loaded.T1 as TaskPanel
    const t2 = loaded.T2 as TaskPanel
    expect(allTabs(t1).map((tab) => tab.kind)).toEqual(["files", "browser"])
    expect(current(t1)).toBe("t2")
    expect(browserUrl(allTabs(t1)[1] as Extract<PanelItem, { kind: "browser" }>)).toBe("https://a.test/")
    expect(allTabs(t2).map((tab) => tab.kind)).toEqual(["files", "browser"])
    expect(current(t2)).toBe("t1")
  })

  test("a task that was on Diff comes back on Files: its file was never kept", () => {
    const loaded = loadPanels(null, legacy({ T1: "diff" }, {}))
    expect(allTabs(loaded.T1 as TaskPanel).map((tab) => tab.kind)).toEqual(["files"])
  })

  test("a task on the Browser with no address yet keeps a blank Browser tab", () => {
    const loaded = loadPanels(null, legacy({ T1: "browser" }, {}))
    const panel = loaded.T1 as TaskPanel
    expect(allTabs(panel).map((tab) => tab.kind)).toEqual(["files", "browser"])
    expect(current(panel)).toBe("t2")
  })

  test("a task already stored in the new form keeps it; nothing is lost from the old keys", () => {
    const stored = JSON.stringify({ T1: showDiff(newPanel(), "a.ts", "working") })
    const loaded = loadPanels(stored, legacy({ T1: "browser", T2: "browser" }, { T2: "https://b.test/" }))
    expect(allTabs(loaded.T1 as TaskPanel).map((tab) => tab.kind)).toEqual(["files", "diff"])
    expect(Object.keys(loaded).sort()).toEqual(["T1", "T2"])
  })

  test("only the newest 50 tasks are kept, the old ones' tabs older than the stored", () => {
    const tab = Object.fromEntries(Array.from({ length: 60 }, (_, n) => [`T${n}`, "browser"]))
    expect(Object.keys(loadPanels(null, legacy(tab, {})))).toHaveLength(50)
    expect(loadPanels(null, { tab: "not json", url: null })).toEqual({})
  })
})

describe("rove api panel-show", () => {
  const push = (extra: Partial<PanelPush> = {}): PanelPush => ({ taskId: "T1", view: "browser", at: 1, ...extra })
  const here = { taskId: "T1", narrow: false }
  const apply = (panel: TaskPanel, extra: Partial<PanelPush>) => applyPlan(panel, planPanelPush(push(extra), here))

  test("an address focuses the Browser tab on it, or opens one", () => {
    const opened = apply(newPanel(), { url: "https://a.test/" })
    expect(allTabs(opened)).toHaveLength(2)
    const refocused = apply(activate(opened, "t1"), { url: "https://a.test/" })
    expect(allTabs(refocused)).toHaveLength(2)
    expect(current(refocused)).toBe("t2")
  })

  test("a file opens or focuses its Diff tab, whether Files or Diff was asked for", () => {
    const opened = apply(newPanel(), { view: "files", path: "src/a.ts" })
    const again = apply(opened, { view: "diff", path: "src/a.ts" })
    expect(diffs(again)).toHaveLength(1)
  })

  test("Files focuses the one that exists, and the view alone never opens a duplicate", () => {
    const panel = apply(showDiff(newPanel(), "a.ts", "working"), { view: "files" })
    expect(allTabs(panel)).toHaveLength(2)
    expect(current(panel)).toBe("t1")
    expect(allTabs(apply(panel, { view: "diff" }))).toHaveLength(2)
  })
})
