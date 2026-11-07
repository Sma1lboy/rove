import { describe, expect, test } from "bun:test"
import { type BrowserColumn, browserUrl } from "../src/browser-tabs.ts"
import { type PanelPush, applyPlan, planPanelPush } from "../src/panel-contract.ts"
import {
  type TaskPanel,
  closeColumn,
  columnOf,
  columnWeights,
  editBrowser,
  launch,
  moveDivider,
  newPanel,
  resetWidths,
  setWidths,
  showBrowser,
  showDiff,
  showKind,
} from "../src/panel-model.ts"

const kinds = (panel: TaskPanel) => panel.columns.map((col) => col.kind)
const browser = (panel: TaskPanel) => columnOf(panel, "browser") as BrowserColumn

describe("opening columns", () => {
  test("a task never opened has Files alone", () => {
    expect(kinds(newPanel())).toEqual(["files"])
  })

  // A file opened from Files landed right of the Browser, far from the tree it came from.
  test("columns sit in one fixed order whatever order they were opened in: Context first, Browser last", () => {
    let panel = showKind(newPanel(), "browser")
    panel = showDiff(panel, "a.ts", "working")
    panel = showKind(panel, "quota")
    expect(kinds(panel)).toEqual(["quota", "files", "diff", "browser"])
    expect(kinds(showKind(closeColumn(panel, "files"), "files"))).toEqual(["quota", "files", "diff", "browser"])
  })

  test("a kind alone opens Diff on the whole worktree and the Browser blank", () => {
    const panel = showKind(showKind(newPanel(), "diff"), "browser")
    expect(columnOf(panel, "diff")).toEqual({ kind: "diff", path: ".", scope: "working" })
    expect(browserUrl(browser(panel).tabs[0] as never)).toBe("")
  })
})

describe("the Diff column", () => {
  test("another diff retargets the one column: path and scope, same place", () => {
    let panel = showDiff(showKind(newPanel(), "quota"), "a.ts", "working")
    const before = kinds(panel)
    panel = showDiff(panel, "b.ts", "branch")
    expect(kinds(panel)).toEqual(before)
    expect(panel.columns.filter((col) => col.kind === "diff")).toEqual([
      { kind: "diff", path: "b.ts", scope: "branch" },
    ])
  })

  test("asking for what it already shows changes nothing", () => {
    const panel = showDiff(newPanel(), "a.ts", "task")
    expect(showDiff(panel, "a.ts", "task")).toBe(panel)
  })

  test("closing it forgets the file: reopening starts on the whole worktree", () => {
    const panel = closeColumn(showDiff(newPanel(), "a.ts", "task"), "diff")
    expect(columnOf(panel, "diff")).toBeUndefined()
    expect(columnOf(showKind(panel, "diff"), "diff")).toEqual({ kind: "diff", path: ".", scope: "working" })
  })
})

describe("the Browser column", () => {
  test("an address shows the tab already on it, else fills a blank one, else opens a tab", () => {
    const first = showBrowser(newPanel(), "https://a.test/")
    expect(browser(first).tabs).toHaveLength(1)
    expect(kinds(first)).toEqual(["files", "browser"])

    const again = showBrowser(first, "https://a.test/")
    expect(browser(again).tabs).toHaveLength(1)

    const other = showBrowser(first, "https://b.test/")
    expect(browser(other).tabs.map(browserUrl)).toEqual(["https://a.test/", "https://b.test/"])
    expect(browserUrl(browser(other).tabs.find((tab) => tab.id === browser(other).active) as never)).toBe(
      "https://b.test/",
    )

    const blank = showBrowser(showKind(newPanel(), "browser"), "https://c.test/")
    expect(browser(blank).tabs.map(browserUrl)).toEqual(["https://c.test/"])
  })

  test("closing the last tab closes the column, and the panel keeps the rest", () => {
    const panel = showBrowser(newPanel(), "https://a.test/")
    const closed = editBrowser(panel, () => null)
    expect(kinds(closed)).toEqual(["files"])
  })

  test("an edit with no Browser column does nothing", () => {
    const panel = newPanel()
    expect(editBrowser(panel, () => null)).toBe(panel)
  })
})

describe("the launcher buttons", () => {
  test("each toggles its own column; the others stay", () => {
    let state = launch(newPanel(), true, "browser")
    expect(kinds(state.panel)).toEqual(["files", "browser"])
    state = launch(state.panel, true, "diff")
    expect(kinds(state.panel)).toEqual(["files", "diff", "browser"])
    state = launch(state.panel, true, "browser")
    expect(kinds(state.panel)).toEqual(["files", "diff"])
    expect(state.open).toBe(true)
  })

  test("closing the last column closes the panel", () => {
    expect(launch(newPanel(), true, "files")).toEqual({ panel: { columns: [], weights: {} }, open: false })
  })

  test("with the panel hidden (closed, or zen) a button opens its column instead of closing it", () => {
    const panel = newPanel()
    expect(launch(panel, false, "files")).toEqual({ panel, open: true })
    expect(kinds(launch(panel, false, "diff").panel)).toEqual(["files", "diff"])
  })
})

describe("sharing the width", () => {
  const three = () => showKind(showKind(newPanel(), "diff"), "quota")

  test("columns share equally until a divider is dragged", () => {
    expect(columnWeights(three())).toEqual([1000 / 3, 1000 / 3, 1000 / 3])
  })

  test("a column opened later takes the mean of the others, not a sliver", () => {
    let panel = setWidths(showKind(newPanel(), "diff"), [300, 100])
    panel = showKind(panel, "quota")
    const [quota, files, diff] = columnWeights(panel) as [number, number, number]
    expect(files / diff).toBeCloseTo(3)
    expect(quota).toBeCloseTo((files + diff) / 2, 0)
  })

  test("shares are keyed by kind, so closing a middle column leaves the others as they were", () => {
    let panel = setWidths(three(), [100, 300, 100])
    panel = closeColumn(panel, "files")
    expect(kinds(panel)).toEqual(["quota", "diff"])
    const [quota, diff] = columnWeights(panel) as [number, number]
    expect(quota).toBeCloseTo(diff)
  })

  test("double-clicking a divider goes back to equal shares", () => {
    const panel = setWidths(three(), [100, 300, 100])
    expect(columnWeights(resetWidths(panel))[0]).toBeCloseTo(1000 / 3)
    expect(resetWidths(newPanel())).toEqual(newPanel())
  })

  test("a divider moves only its two neighbours and leaves each at least the minimum", () => {
    expect(moveDivider([300, 300, 300], 0, 50, 220)).toEqual([350, 250, 300])
    expect(moveDivider([300, 300, 300], 0, -500, 220)).toEqual([220, 380, 300])
    expect(moveDivider([300, 300, 300], 1, 500, 220)).toEqual([300, 380, 220])
  })

  test("in a panel too narrow for the minimum a divider can still halve what its neighbours have", () => {
    expect(moveDivider([100, 100], 0, 80, 220)).toEqual([100, 100])
  })

  test("widths for other columns than the open ones are ignored", () => {
    const panel = three()
    expect(setWidths(panel, [1, 2])).toBe(panel)
  })
})

describe("rove api panel-show", () => {
  const push = (extra: Partial<PanelPush> = {}): PanelPush => ({ taskId: "T1", view: "browser", at: 1, ...extra })
  const here = { taskId: "T1", narrow: false }
  const apply = (panel: TaskPanel, extra: Partial<PanelPush>) => applyPlan(panel, planPanelPush(push(extra), here))

  test("an address opens the Browser column, or focuses the tab already on it", () => {
    const opened = apply(newPanel(), { url: "https://a.test/" })
    expect(kinds(opened)).toEqual(["files", "browser"])
    const again = apply(opened, { url: "https://a.test/" })
    expect(browser(again).tabs).toHaveLength(1)
    expect(browser(apply(again, { url: "https://b.test/" })).tabs).toHaveLength(2)
  })

  test("a file opens the Diff column on it, whether Files or Diff was asked for; another file retargets it", () => {
    const opened = apply(newPanel(), { view: "files", path: "src/a.ts" })
    expect(columnOf(opened, "diff")).toEqual({ kind: "diff", path: "src/a.ts", scope: "working" })
    const next = apply(opened, { view: "diff", path: "src/b.ts" })
    expect(next.columns.filter((col) => col.kind === "diff")).toHaveLength(1)
    expect(columnOf(next, "diff")).toMatchObject({ path: "src/b.ts" })
  })

  test("a view alone opens its column if closed and never a second one", () => {
    const panel = apply(showDiff(newPanel(), "a.ts", "working"), { view: "files" })
    expect(kinds(panel)).toEqual(["files", "diff"])
    expect(kinds(apply(closeColumn(panel, "files"), { view: "files" }))).toEqual(["files", "diff"])
    expect(columnOf(apply(panel, { view: "diff" }), "diff")).toMatchObject({ path: "a.ts" })
  })
})
