/**
 * The daemon's tab store is the one writer of every task's terminal tabs.
 * These pin its rules and replay the multi-client races that used to corrupt
 * the tabs when each client wrote its own copy to state.json.
 */

import {
  type SharedTabs,
  type TabRow,
  applyTabOps,
  diffTabs,
  releaseOrdinals,
  reserveOrdinals,
} from "@sma1lboy/rove-daemon/daemon/tabs-ops"
import { type TabsChangedPayload, type TabsPersistence, TabsStore } from "@sma1lboy/rove-daemon/daemon/tabs-store"
import { afterEach, describe, expect, it, vi } from "vitest"

const row = (id: string, extra: Record<string, unknown> = {}): TabRow => ({
  kind: "engine",
  id,
  ordinal: Number(id.slice(4)),
  title: null,
  ...extra,
})
const state = (ids: readonly string[], nextOrdinal = ids.length + 1): SharedTabs => ({
  tabs: ids.map((id) => row(id)),
  nextOrdinal,
})
const ids = (s: SharedTabs | null) => s?.tabs.map((t) => t.id)

function store() {
  const published: TabsChangedPayload[] = []
  const saved: Record<string, SharedTabs | null>[] = []
  const persistence: TabsPersistence = { load: () => ({}), save: (changes) => void saved.push({ ...changes }) }
  const tabs = new TabsStore(persistence, {
    publish: (channel: string, payload: unknown) => {
      if (channel === "tabs.changed") published.push(payload as TabsChangedPayload)
    },
  } as never)
  return { tabs, published, saved }
}

/** A client: edits its copy with a reducer, then sends what changed — what `tabs-sync.ts` does. */
function edit(tabs: TabsStore, taskId: string, copy: SharedTabs, reducer: (s: SharedTabs) => SharedTabs) {
  return tabs.apply(taskId, diffTabs(copy, reducer(copy)))
}

afterEach(() => vi.useRealTimers())

describe("tab ops", () => {
  it("open mints from the one counter, or takes a reserved id; a known or closed id is refused", () => {
    const tombstones = new Set<string>()
    let s = applyTabOps(state(["tab-1"]), [{ op: "open", row: { kind: "engine", title: null } }], tombstones)
    expect(s.opened).toEqual(["tab-2"])
    expect(s.state?.nextOrdinal).toBe(3)
    s = applyTabOps(s.state, [{ op: "close", id: "tab-2" }], tombstones)
    const again = applyTabOps(
      s.state,
      [
        { op: "open", row: row("tab-2") },
        { op: "open", row: row("tab-1") },
      ],
      tombstones,
    )
    expect(again.opened).toEqual([null, null])
    expect(again.changed).toBe(false)
  })

  it("places a new row after its neighbour, first for null, last otherwise", () => {
    const base = state(["tab-1", "tab-2"])
    const s = applyTabOps(base, [
      { op: "open", row: row("tab-3"), after: "tab-1" },
      { op: "open", row: row("tab-4"), after: null },
      { op: "open", row: row("tab-5") },
    ]).state
    expect(ids(s)).toEqual(["tab-4", "tab-1", "tab-3", "tab-2", "tab-5"])
  })

  it("patch changes only named fields of a live row and never revives a closed one", () => {
    const s = applyTabOps(state(["tab-1", "tab-2"]), [
      { op: "patch", id: "tab-1", set: { title: "a" } },
      { op: "close", id: "tab-2" },
      { op: "patch", id: "tab-2", set: { title: "b" } },
    ]).state
    expect(s?.tabs).toEqual([row("tab-1", { title: "a" })])
  })

  it("order puts the named ids first and keeps the rest in place", () => {
    const s = applyTabOps(state(["tab-1", "tab-2", "tab-3"]), [{ op: "order", ids: ["tab-3", "tab-1"] }]).state
    expect(ids(s)).toEqual(["tab-3", "tab-1", "tab-2"])
  })

  it("seed only fills a missing record", () => {
    expect(ids(applyTabOps(null, [{ op: "seed", state: state(["tab-1"]) }]).state)).toEqual(["tab-1"])
    expect(ids(applyTabOps(state(["tab-1", "tab-2"]), [{ op: "seed", state: state(["tab-9"]) }]).state)).toEqual([
      "tab-1",
      "tab-2",
    ])
  })

  it("reserved ordinals are disjoint, and an unused tail goes back", () => {
    const a = reserveOrdinals(state(["tab-1"]), 2)
    const b = reserveOrdinals(a.state, 2)
    expect([a.from, b.from]).toEqual([2, 4])
    expect(releaseOrdinals(b.state, 4, 6)?.nextOrdinal).toBe(4)
    // Not the tail any more: nothing to give back.
    expect(releaseOrdinals(b.state, 2, 4)?.nextOrdinal).toBe(6)
  })

  it("diff turns a reducer's result into opens, closes, patches and an order", () => {
    const prev = state(["tab-1", "tab-2", "tab-3"])
    const next: SharedTabs = {
      tabs: [row("tab-3"), row("tab-1", { title: "x" }), row("tab-4")],
      nextOrdinal: 5,
    }
    const after = applyTabOps(prev, diffTabs(prev, next)).state
    expect(after?.tabs).toEqual(next.tabs)
  })
})

describe("two clients on one task", () => {
  it("a tab A closes is gone for B, and B's stale copy cannot bring it back", () => {
    const { tabs } = store()
    tabs.apply("t", [{ op: "seed", state: state(["tab-1", "tab-2", "tab-3"]) }])
    const bCopy = tabs.get("t").state as SharedTabs
    // A closes tab-3.
    const aCopy = tabs.get("t").state as SharedTabs
    edit(tabs, "t", aCopy, (s) => ({ ...s, tabs: s.tabs.filter((t) => t.id !== "tab-3") }))
    // B, still holding tab-3, renames tab-1 and touches tab-3 (a title probe).
    edit(tabs, "t", bCopy, (s) => ({
      ...s,
      tabs: s.tabs.map((t) =>
        t.id === "tab-1" ? { ...t, title: "renamed" } : t.id === "tab-3" ? { ...t, title: "x" } : t,
      ),
    }))
    // The orphan poll sees tab-3's dying session and adopts it.
    tabs.apply("t", [{ op: "open", row: row("tab-3") }])
    expect(tabs.get("t").state?.tabs).toEqual([row("tab-1", { title: "renamed" }), row("tab-2")])
  })

  it("A and B opening at the same moment get two tabs with two ids", () => {
    const { tabs } = store()
    tabs.apply("t", [{ op: "seed", state: state(["tab-1"]) }])
    const a = tabs.reserve("t", 2)
    const b = tabs.reserve("t", 2)
    const copy = tabs.get("t").state as SharedTabs
    // Each mints from its own reservation off the same stale copy.
    edit(tabs, "t", copy, (s) => ({ ...s, tabs: [...s.tabs, row(`tab-${a.from}`)] }))
    edit(tabs, "t", copy, (s) => ({ ...s, tabs: [...s.tabs, row(`tab-${b.from}`)] }))
    // Both land, each where its client put it (after tab-1); every client then shows this one order.
    expect(ids(tabs.get("t").state)).toEqual(["tab-1", `tab-${b.from}`, `tab-${a.from}`])
    expect(a.from).not.toBe(b.from)
  })

  it("every change is published with a rising revision, so a client keeps the newest", () => {
    const { tabs, published } = store()
    tabs.apply("t", [{ op: "seed", state: state(["tab-1"]) }])
    tabs.apply("t", [{ op: "open", row: { kind: "engine", title: null } }])
    tabs.apply("t", [{ op: "patch", id: "tab-1", set: { title: null } }]) // no change: no publish
    expect(published.map((p) => [p.rev, ids(p.state)])).toEqual([
      [1, ["tab-1"]],
      [2, ["tab-1", "tab-2"]],
    ])
  })
})

describe("persistence", () => {
  it("writes a structural change at once, debounces title probes, drops a deleted task's record", () => {
    vi.useFakeTimers()
    const { tabs, saved } = store()
    tabs.apply("t", [{ op: "seed", state: state(["tab-1"]) }])
    expect(saved).toHaveLength(1)
    tabs.apply("t", [{ op: "patch", id: "tab-1", set: { lastTitle: "⠋ working" } }])
    tabs.apply("t", [{ op: "patch", id: "tab-1", set: { lastTitle: "⠙ working" } }])
    expect(saved).toHaveLength(1)
    vi.advanceTimersByTime(300)
    expect(saved).toHaveLength(2)
    tabs.forget("t")
    expect(saved.at(-1)).toEqual({ t: null })
  })

  it("sweeps records of tasks that are gone, but never against an empty task list", () => {
    const { tabs } = store()
    tabs.apply("live", [{ op: "seed", state: state(["tab-1"]) }])
    tabs.apply("gone", [{ op: "seed", state: state(["tab-1"]) }])
    expect(tabs.sweep(() => false, false)).toBe(0)
    expect(tabs.sweep((id) => id === "live", true)).toBe(1)
    expect(Object.keys(tabs.list().tasks)).toEqual(["live"])
  })
})
