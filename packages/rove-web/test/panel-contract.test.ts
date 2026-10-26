import { describe, expect, test } from "bun:test"
import { type PanelPush, isPanelPush, panelFields, planPanelPush } from "../src/panel-contract.ts"

const push = (extra: Partial<PanelPush> = {}): PanelPush => ({ taskId: "T1", view: "browser", at: 1, ...extra })

describe("what the page reports about its panel", () => {
  test("a desktop page has a panel, which zen hides", () => {
    expect(panelFields({ narrow: false, panelOpen: true, zen: false })).toEqual({
      panel: true,
      panelOpen: true,
      narrow: false,
    })
    expect(panelFields({ narrow: false, panelOpen: true, zen: true }).panelOpen).toBe(false)
    expect(panelFields({ narrow: false, panelOpen: false, zen: false }).panelOpen).toBe(false)
  })

  test("a narrow page has no panel to open, whatever the desktop layout was left at", () => {
    expect(panelFields({ narrow: true, panelOpen: true, zen: false })).toEqual({
      panel: false,
      panelOpen: false,
      narrow: true,
    })
  })
})

describe("a panel push", () => {
  test("only a well-formed request is taken", () => {
    expect(isPanelPush(push({ view: "files", path: "src/a.ts" }))).toBe(true)
    for (const bad of [
      null,
      "x",
      {},
      { ...push(), view: "pdf" },
      { ...push(), at: "1" },
      { ...push(), url: 5 },
      { ...push(), taskId: "" },
    ]) {
      expect(isPanelPush(bad)).toBe(false)
    }
  })

  test("the page on that task, with a panel, opens it; any other page only remembers", () => {
    const here = { taskId: "T1", narrow: false }
    expect(planPanelPush(push(), here).show).toBe(true)
    expect(planPanelPush(push(), { ...here, taskId: "T2" }).show).toBe(false)
    expect(planPanelPush(push(), { ...here, taskId: null }).show).toBe(false)
    expect(planPanelPush(push(), { ...here, narrow: true }).show).toBe(false)
  })

  test("every page keeps the view for the task, even one that does not show it", () => {
    expect(planPanelPush(push({ url: "https://example.com/" }), { taskId: "T2", narrow: true })).toEqual({
      tab: "browser",
      url: "https://example.com/",
      show: false,
    })
  })

  test("a file opens as its diff: the web has no file viewer", () => {
    const here = { taskId: "T1", narrow: false }
    expect(planPanelPush(push({ view: "files", path: "src/a.ts" }), here)).toEqual({
      tab: "diff",
      diff: "src/a.ts",
      show: true,
    })
    expect(planPanelPush(push({ view: "diff" }), here)).toEqual({ tab: "diff", show: true })
    expect(planPanelPush(push({ view: "files" }), here)).toEqual({ tab: "files", show: true })
  })

  test("a path means nothing to the Browser, an address nothing to Files", () => {
    const here = { taskId: "T1", narrow: false }
    expect(planPanelPush(push({ view: "browser", path: "a.ts" }), here)).toEqual({ tab: "diff", show: true })
    expect(planPanelPush(push({ view: "files", url: "https://example.com/" }), here)).toEqual({
      tab: "files",
      show: true,
    })
  })
})
