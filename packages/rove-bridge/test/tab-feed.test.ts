import { expect, test } from "bun:test"
import { TabFeed } from "../src/tab-feed.ts"

test("pushes exactly the tasks whose tab snapshot changed, appeared or went away", () => {
  let state: Record<string, unknown> = {
    theme: "rove",
    "terminalTabs.A": { tabs: [{ id: "tab-1", title: "old" }] },
    "terminalTabs.B": { tabs: [{ id: "tab-1" }] },
    "terminalTabs.C": { tabs: [{ id: "tab-1" }] },
  }
  const feed = new TabFeed(() => state)
  const pushed: string[][] = []
  feed.subscribe((ids) => pushed.push([...ids]))

  state = { ...state, theme: "other" }
  feed.check()
  expect(pushed).toEqual([])

  state = {
    theme: "other",
    "terminalTabs.A": { tabs: [{ id: "tab-1", title: "renamed" }] },
    "terminalTabs.B": { tabs: [{ id: "tab-1" }, { id: "tab-2" }] },
    "terminalTabs.D": { tabs: [{ id: "tab-1" }] },
  }
  feed.check()
  expect(pushed.map((ids) => ids.sort())).toEqual([["A", "B", "C", "D"]])
})
