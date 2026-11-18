import { describe, expect, test } from "bun:test"
import {
  type BrowserColumn,
  MAX_FRAMES,
  MAX_TABS,
  activateTab,
  blankBrowser,
  browserUrl,
  closeOtherTabs,
  closeTab,
  mountedTabs,
  navigate,
  newTab,
  openUrl,
  stepTab,
} from "../src/browser-tabs.ts"

const urls = (col: BrowserColumn) => col.tabs.map(browserUrl)
/** A column that opened `n` addresses in turn. */
const many = (n: number) =>
  Array.from({ length: n }, (_, i) => `https://${i}.test/`).reduce((col, url) => openUrl(col, url), blankBrowser())
/** The frames left mounted after showing each tab in turn. */
const showEach = (col: BrowserColumn) =>
  col.tabs.reduce<string[]>((mounted, tab) => mountedTabs(mounted, tab.id, col.tabs), [])

describe("tabs", () => {
  test("a new tab is blank, shown, and added on the right", () => {
    const col = newTab(blankBrowser())
    expect(col.tabs.map((tab) => tab.id)).toEqual(["t1", "t2"])
    expect(col.active).toBe("t2")
  })

  test("an address shows the tab on it, else fills a blank tab, else opens one", () => {
    const first = openUrl(blankBrowser(), "https://a.test/")
    expect(urls(first)).toEqual(["https://a.test/"])
    const second = openUrl(first, "https://b.test/")
    expect(urls(second)).toEqual(["https://a.test/", "https://b.test/"])
    expect(second.active).toBe("t2")
    expect(openUrl(second, "https://a.test/").active).toBe("t1")
    expect(urls(openUrl(newTab(first), "https://c.test/"))).toEqual(["https://a.test/", "https://c.test/"])
  })

  test("past the tab limit the least recently shown tab that is not on screen closes", () => {
    const col = many(MAX_TABS + 2)
    expect(col.tabs).toHaveLength(MAX_TABS)
    expect(urls(col)).toContain(`https://${MAX_TABS + 1}.test/`)
    expect(urls(col)).not.toContain("https://0.test/")
  })
})

describe("a tab's own history", () => {
  test("typing after going back drops the forward entries", () => {
    let col = ["https://a.test/", "https://b.test/", "https://c.test/"].reduce(
      (c, url) => navigate(c, "t1", url),
      blankBrowser(),
    )
    col = stepTab(col, "t1", 0)
    col = navigate(col, "t1", "https://d.test/")
    expect(col.tabs[0]).toMatchObject({ urls: ["https://a.test/", "https://d.test/"], at: 1 })
  })

  test("stepping outside the history does nothing", () => {
    const col = navigate(blankBrowser(), "t1", "https://a.test/")
    expect(stepTab(col, "t1", 1)).toBe(col)
    expect(stepTab(col, "t1", -1)).toBe(col)
  })
})

describe("closing", () => {
  test("the tab shown before the closed one comes back", () => {
    let col = newTab(newTab(blankBrowser()))
    col = activateTab(activateTab(col, "t1"), "t3")
    expect(closeTab(col, "t3")?.active).toBe("t1")
  })

  test("closing a tab that is not shown keeps the shown one", () => {
    const col = newTab(blankBrowser())
    expect(closeTab(col, "t1")?.active).toBe("t2")
  })

  test("closing the last tab says so, for the column to close with it", () => {
    expect(closeTab(blankBrowser(), "t1")).toBeNull()
  })

  test("close others keeps the one tab, shown", () => {
    const col = closeOtherTabs(newTab(newTab(blankBrowser())), "t2")
    expect(col.tabs.map((tab) => tab.id)).toEqual(["t2"])
    expect(col.active).toBe("t2")
  })
})

describe("which tabs keep a live frame", () => {
  test("past the cap the least recently shown frames go; the shown one stays", () => {
    const col = many(MAX_FRAMES + 2)
    const mounted = showEach(col)
    expect(mounted).toHaveLength(MAX_FRAMES)
    expect(mounted).not.toContain("t1")
    expect(mounted.at(-1)).toBe(col.tabs.at(-1)?.id as string)
  })

  test("going back to a dropped tab brings its frame back and drops the oldest", () => {
    const col = many(MAX_FRAMES + 1)
    const mounted = mountedTabs(showEach(col), "t1", col.tabs)
    expect(mounted.at(-1)).toBe("t1")
    expect(mounted).toHaveLength(MAX_FRAMES)
  })

  test("a closed tab is unmounted", () => {
    const col = newTab(blankBrowser())
    expect(mountedTabs(["t1", "t9"], "t2", col.tabs)).toEqual(["t1", "t2"])
  })
})
