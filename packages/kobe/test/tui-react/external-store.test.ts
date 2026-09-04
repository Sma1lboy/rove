import { describe, expect, it, vi } from "vitest"
import {
  clearRecentStateChangesForTest,
  createStateCell,
  recentStateChangesForDiagnostics,
} from "../../src/lib/external-store"

describe("createStateCell", () => {
  it("get returns the current snapshot; set replaces it", () => {
    const store = createStateCell({ n: 1 })
    expect(store.get()).toEqual({ n: 1 })
    expect(store()).toEqual({ n: 1 })
    expect(store.get).toBe(store)
    store.set({ n: 2 })
    expect(store.get()).toEqual({ n: 2 })
    expect(store()).toEqual({ n: 2 })
  })

  it("notifies subscribers on change and stops after unsubscribe", () => {
    const store = createStateCell(0)
    const seen: number[] = []
    const unsub = store.subscribe(() => seen.push(store.get()))
    store.set(1)
    store.set(2)
    unsub()
    store.set(3)
    expect(seen).toEqual([1, 2])
  })

  it("dedupes identical snapshots (Object.is) — no phantom notifications", () => {
    const store = createStateCell("a")
    const listener = vi.fn()
    store.subscribe(listener)
    store.set("a")
    expect(listener).not.toHaveBeenCalled()
    store.set("b")
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("update applies a functional transform over the current snapshot", () => {
    const store = createStateCell({ count: 1 })
    store.update((s) => ({ count: s.count + 1 }))
    expect(store.get()).toEqual({ count: 2 })
  })

  it("a listener unsubscribing during notify does not skip other listeners", () => {
    const store = createStateCell(0)
    const seen: string[] = []
    const unsubA = store.subscribe(() => {
      seen.push("a")
      unsubA()
    })
    store.subscribe(() => seen.push("b"))
    store.set(1)
    store.set(2)
    expect(seen).toEqual(["a", "b", "b"])
  })

  it("records labeled transitions by shape without retaining string contents", () => {
    clearRecentStateChangesForTest()
    const store = createStateCell("private-task-title", "diagnostic-probe")
    store.set("another-private-title")
    const trace = recentStateChangesForDiagnostics()
    expect(trace).toHaveLength(1)
    expect(trace[0]).toContain("diagnostic-probe: string(18) -> string(21)")
    expect(trace[0]).not.toContain("private-task-title")
    expect(trace[0]).not.toContain("another-private-title")
    clearRecentStateChangesForTest()
  })

  it("retains the latest 64 transitions when the diagnostic ring overflows", () => {
    clearRecentStateChangesForTest()
    const store = createStateCell(-1, "overflow-probe")
    for (let value = 0; value <= 64; value += 1) store.set(value)

    const trace = recentStateChangesForDiagnostics()
    expect(trace).toHaveLength(64)
    expect(trace[0]).toContain("overflow-probe: 0 -> 1")
    expect(trace.at(-1)).toContain("overflow-probe: 63 -> 64")
    clearRecentStateChangesForTest()
  })
})
