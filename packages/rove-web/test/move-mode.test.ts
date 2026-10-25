import { describe, expect, test } from "bun:test"

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
g.localStorage ??= {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
}
const { moveMode, setMoveMode } = await import("../src/move-mode.ts")
const { railSort, setRailSort } = await import("../src/rail-sort.ts")
const { toasts } = await import("../src/ui.ts")

describe("Reorder (move mode) and the sort", () => {
  test("a fresh browser starts on recency", () => {
    expect(railSort.get()).toBe("recent")
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
    setMoveMode(false)
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
