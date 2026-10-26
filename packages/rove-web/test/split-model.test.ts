import { describe, expect, test } from "bun:test"
import type { SplitView, TabRow } from "rove-bridge/protocol"
import { hasLivePane, hostsEngine } from "../src/split-model.ts"

const split: SplitView = {
  root: {
    kind: "group",
    orientation: "row",
    children: [
      { kind: "leaf", id: "leaf-1", title: null, own: true },
      { kind: "leaf", id: "leaf-2", title: null, own: false },
    ],
  },
  activeLeafId: "leaf-1",
}

describe("which pane hosts the tab's engine", () => {
  test("an engine tab's own pane does; its split shells do not", () => {
    const tab = { id: "tab-1", kind: "engine" } as TabRow
    expect(hostsEngine(tab, split, "leaf-1")).toBe(true)
    expect(hostsEngine(tab, split, "leaf-2")).toBe(false)
  })

  test("a shell tab's own pane is only a shell", () => {
    expect(hostsEngine({ id: "tab-2", kind: "command" } as TabRow, split, "leaf-1")).toBe(false)
  })

  test("once the own pane is gone no pane hosts it", () => {
    const left: SplitView = { root: { kind: "leaf", id: "leaf-2", title: null, own: false }, activeLeafId: "leaf-2" }
    expect(hostsEngine({ id: "tab-1", kind: "engine" } as TabRow, left, "leaf-2")).toBe(false)
  })
})

describe("which tabs can be split from the rail", () => {
  const left: SplitView = { root: { kind: "leaf", id: "leaf-2", title: null, own: false }, activeLeafId: "leaf-2" }

  test("a running tab can; a dead one cannot", () => {
    expect(hasLivePane({ id: "tab-1", alive: true } as TabRow)).toBe(true)
    expect(hasLivePane({ id: "tab-1", alive: null } as TabRow)).toBe(true)
    expect(hasLivePane({ id: "tab-1", alive: false } as TabRow)).toBe(false)
  })

  test("a tab the daemon calls dead still can once only a split shell is left in it", () => {
    expect(hasLivePane({ id: "tab-1", alive: false, split: left } as TabRow)).toBe(true)
    expect(hasLivePane({ id: "tab-1", alive: false, split } as TabRow)).toBe(false)
  })
})
