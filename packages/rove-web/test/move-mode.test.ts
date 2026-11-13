import { beforeEach, describe, expect, test } from "bun:test"

// move-mode pulls in i18n and the sort store, which read browser globals at load.
const g = globalThis as Record<string, unknown>
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { language: "en-US", languages: ["en-US"], platform: "Linux", userAgent: "bun" },
})
g.window ??= globalThis
// Another test file may have installed a bare `window`; the toast timer needs its setTimeout.
const win = g.window as { setTimeout?: typeof setTimeout }
win.setTimeout ??= setTimeout
const memory = new Map<string, string>()
// Its own store, always: an earlier file may have left a stub that drops writes, and these tests read theirs back.
g.localStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
}
const { moveMode, setMoveMode } = await import("../src/move-mode.ts")
const { loadSort, railSort, setRailSort } = await import("../src/rail-sort.ts")
const { toasts } = await import("../src/ui.ts")

describe("Reorder (move mode) and the sort", () => {
  beforeEach(() => setMoveMode(false))

  test("a fresh browser starts on recency", () => {
    memory.clear()
    expect(loadSort()).toBe("recent")
  })

  test("another browser's sort is taken up here", async () => {
    const { prefsStore } = await import("../src/prefs.ts")
    const now = prefsStore.get()
    prefsStore.set({ ...now, loaded: true, prefs: { ...now.prefs, railSort: "attention" } })
    expect(railSort.get()).toBe("attention")
    expect(localStorage.getItem("rove.activeSortMode")).toBe("attention")
  })

  test("turning move mode on under another sort switches to manual first, persists it, and says so", () => {
    setRailSort("name")
    setMoveMode(true)
    expect(moveMode.get()).toBe(true)
    expect(railSort.get()).toBe("default")
    expect(localStorage.getItem("rove.activeSortMode")).toBe("default")
    expect(toasts.get().length).toBeGreaterThan(0)
  })

  test("under manual order it changes nothing but the mode, and turning it off keeps the sort", () => {
    const shown = toasts.get().length
    setRailSort("default")
    setMoveMode(true)
    expect(railSort.get()).toBe("default")
    expect(toasts.get()).toHaveLength(shown)
    setMoveMode(false)
    expect(moveMode.get()).toBe(false)
    setRailSort("recent")
    setMoveMode(false)
    expect(railSort.get()).toBe("recent")
  })
})
