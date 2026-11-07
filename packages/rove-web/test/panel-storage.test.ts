import { describe, expect, test } from "bun:test"
import { type BrowserColumn, browserUrl } from "../src/browser-tabs.ts"
import { type TaskPanel, newPanel, setWidths, showBrowser, showDiff, showKind } from "../src/panel-model.ts"
import { REMEMBERED_TASKS, loadPanels, parsePanel, remember } from "../src/panel-storage.ts"

const kinds = (panel: TaskPanel) => panel.columns.map((col) => col.kind)
const col = (panel: TaskPanel, kind: string) => panel.columns.find((c) => c.kind === kind)

describe("what is stored", () => {
  test("a panel survives a round trip", () => {
    let panel = showDiff(showBrowser(newPanel(), "https://a.test/"), "a.ts", "branch")
    panel = setWidths(showKind(panel, "quota"), [100, 300, 100, 100])
    expect(parsePanel(JSON.parse(JSON.stringify(panel)))).toEqual(panel)
  })

  test("damaged entries are dropped, one column per kind, and ids never repeat after a load", () => {
    const parsed = parsePanel({
      columns: [
        { kind: "files" },
        { kind: "files" },
        { kind: "pdf" },
        { kind: "diff", path: "" },
        { kind: "diff", path: "a.ts", scope: "weird" },
        {
          kind: "browser",
          tabs: [{ id: "t4", urls: ["https://a.test/", 5, ""], at: 9 }, { id: "x" }, { id: "t4", urls: [] }],
          active: "gone",
          next: 1,
        },
      ],
      weights: { files: 2, diff: -1, browser: "wide", pdf: 1 },
    })
    expect(parsed && kinds(parsed)).toEqual(["files", "diff", "browser"])
    expect(col(parsed as TaskPanel, "diff")).toEqual({ kind: "diff", path: "a.ts", scope: "working" })
    const browser = col(parsed as TaskPanel, "browser") as BrowserColumn
    expect(browser.tabs).toEqual([{ id: "t4", urls: ["https://a.test/"], at: 0 }])
    expect(browser.active).toBe("t4")
    expect(browser.next).toBeGreaterThan(4)
    expect(parsed?.weights).toEqual({ files: 2 })
  })

  test("nothing usable is dropped, so the task falls back to a fresh panel", () => {
    expect(parsePanel("nope")).toBeNull()
    expect(parsePanel({})).toBeNull()
    expect(parsePanel({ columns: "x" })).toBeNull()
    expect(parsePanel({ top: "x" })).toBeNull()
    expect(loadPanels(JSON.stringify({ T1: "x", T2: { columns: 3 } }), { tab: null, url: null })).toEqual({})
  })

  test("a panel with every column closed is kept empty", () => {
    expect(parsePanel({ columns: [] })).toEqual({ columns: [], weights: {} })
  })

  test("only the newest 50 tasks are kept", () => {
    let all: Record<string, TaskPanel> = {}
    for (let n = 0; n < REMEMBERED_TASKS + 5; n++) all = remember(all, `T${n}`, newPanel())
    expect(Object.keys(all)).toHaveLength(REMEMBERED_TASKS)
    expect(all.T0).toBeUndefined()
    expect(remember(all, "T10", newPanel()) && Object.keys(remember(all, "T10", newPanel())).at(-1)).toBe("T10")
  })
})

describe("migrating tab groups (the shape before columns)", () => {
  const tab = (id: string, kind: string, extra: Record<string, unknown> = {}) => ({ id, kind, ...extra })
  const old = (top: unknown[], bottom: unknown[] | null = null, extra: Record<string, unknown> = {}) => ({
    top: { tabs: top, active: null },
    bottom: bottom && { tabs: bottom, active: null },
    ratio: 0.4,
    focus: "top",
    recent: [],
    next: 20,
    ...extra,
  })

  test("every kind present becomes a column, in the order the kinds first appear, top group first", () => {
    const panel = parsePanel(
      old(
        [tab("t1", "files"), tab("t2", "browser", { urls: ["https://a.test/"], at: 0 })],
        [tab("t3", "quota"), tab("t4", "diff", { path: "a.ts", scope: "task" })],
      ),
    ) as TaskPanel
    expect(kinds(panel)).toEqual(["files", "browser", "quota", "diff"])
    expect(panel.weights).toEqual({})
  })

  test("the Diff column keeps the diff shown last", () => {
    const tabs = [
      tab("t1", "diff", { path: "a.ts", scope: "working" }),
      tab("t2", "diff", { path: "b.ts", scope: "branch" }),
      tab("t3", "diff", { path: "c.ts", scope: "working" }),
    ]
    const shown = parsePanel(old(tabs, null, { recent: ["t3", "t1", "t2"] })) as TaskPanel
    expect(col(shown, "diff")).toEqual({ kind: "diff", path: "b.ts", scope: "branch" })
    const unseen = parsePanel(old(tabs)) as TaskPanel
    expect(col(unseen, "diff")).toEqual({ kind: "diff", path: "a.ts", scope: "working" })
  })

  test("the Browser column keeps all its tabs in order, with their history, and the one shown last", () => {
    const panel = parsePanel(
      old(
        [
          tab("t1", "browser", { urls: ["https://a.test/", "https://a.test/x"], at: 0 }),
          tab("t2", "files"),
          tab("t5", "browser", { urls: ["https://b.test/"], at: 0 }),
        ],
        [tab("t3", "browser", { urls: [], at: -1 })],
        { recent: ["t5", "t2", "t3", "t1"] },
      ),
    ) as TaskPanel
    const browser = col(panel, "browser") as BrowserColumn
    expect(browser.tabs.map((t) => t.id)).toEqual(["t1", "t5", "t3"])
    expect(browser.tabs[0]).toEqual({ id: "t1", urls: ["https://a.test/", "https://a.test/x"], at: 0 })
    expect(browser.active).toBe("t1")
    expect(browserUrl(browser.tabs[1] as never)).toBe("https://b.test/")
    expect(browser.next).toBeGreaterThan(5)
  })

  test("damaged tabs are skipped; a group with no usable tab is an empty panel", () => {
    const panel = parsePanel(
      old([tab("x", "files"), tab("t1", "pdf"), tab("t2", "diff", { path: "" }), 5]),
    ) as TaskPanel
    expect(kinds(panel)).toEqual([])
  })

  test("loadPanels reads old and new shapes side by side", () => {
    const stored = JSON.stringify({
      T1: old([tab("t1", "files"), tab("t2", "diff", { path: "a.ts", scope: "working" })]),
      T2: showBrowser(newPanel(), "https://a.test/"),
    })
    const loaded = loadPanels(stored, { tab: null, url: null })
    expect(kinds(loaded.T1 as TaskPanel)).toEqual(["files", "diff"])
    expect(kinds(loaded.T2 as TaskPanel)).toEqual(["files", "browser"])
  })
})

describe("migrating the keys before tabs (panelTab, panelUrl)", () => {
  const legacy = (tab: Record<string, string>, url: Record<string, string>) => ({
    tab: JSON.stringify(tab),
    url: JSON.stringify(url),
  })

  test("a task's last address becomes a Browser column", () => {
    const loaded = loadPanels(
      null,
      legacy({ T1: "browser", T2: "files" }, { T1: "https://a.test/", T2: "https://b.test/" }),
    )
    for (const [id, url] of [
      ["T1", "https://a.test/"],
      ["T2", "https://b.test/"],
    ] as const) {
      const panel = loaded[id] as TaskPanel
      expect(kinds(panel)).toEqual(["files", "browser"])
      expect(browserUrl((col(panel, "browser") as BrowserColumn).tabs[0] as never)).toBe(url)
    }
  })

  test("a task that was on Diff comes back on Files: its file was never kept", () => {
    expect(kinds(loadPanels(null, legacy({ T1: "diff" }, {})).T1 as TaskPanel)).toEqual(["files"])
  })

  test("a task on the Browser with no address yet keeps a blank Browser tab", () => {
    const panel = loadPanels(null, legacy({ T1: "browser" }, {})).T1 as TaskPanel
    expect(kinds(panel)).toEqual(["files", "browser"])
    expect((col(panel, "browser") as BrowserColumn).tabs).toHaveLength(1)
  })

  test("a task already stored keeps its panel; nothing is lost from the old keys", () => {
    const stored = JSON.stringify({ T1: showDiff(newPanel(), "a.ts", "working") })
    const loaded = loadPanels(stored, legacy({ T1: "browser", T2: "browser" }, { T2: "https://b.test/" }))
    expect(kinds(loaded.T1 as TaskPanel)).toEqual(["files", "diff"])
    expect(Object.keys(loaded).sort()).toEqual(["T1", "T2"])
  })

  test("only the newest 50 tasks are kept, the old ones older than the stored", () => {
    const tab = Object.fromEntries(Array.from({ length: 60 }, (_, n) => [`T${n}`, "browser"]))
    expect(Object.keys(loadPanels(null, legacy(tab, {})))).toHaveLength(50)
    expect(loadPanels(null, { tab: "not json", url: null })).toEqual({})
  })
})
