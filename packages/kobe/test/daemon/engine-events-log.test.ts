import { EngineEventLog, PER_TASK_CAP, TASK_CAP } from "@sma1lboy/kobe-daemon/daemon/engine-events-log"
import { describe, expect, it } from "vitest"

function event(kind: string, at = Date.now()): { kind: string; at: number } {
  return { kind, at }
}

describe("EngineEventLog", () => {
  it("buffers a task's events newest-last", () => {
    const log = new EngineEventLog()
    log.append("t1", event("a"))
    log.append("t1", event("b"))
    expect(log.recent("t1").map((e) => e.kind)).toEqual(["a", "b"])
  })

  it("returns an empty list for a task that has never been seen", () => {
    expect(new EngineEventLog().recent("nope")).toEqual([])
  })

  it("caps a single task's buffer at PER_TASK_CAP, dropping the oldest events", () => {
    const log = new EngineEventLog()
    for (let i = 0; i < PER_TASK_CAP + 5; i++) log.append("t1", event(`e${i}`))
    const kinds = log.recent("t1").map((e) => e.kind)
    expect(kinds).toHaveLength(PER_TASK_CAP)
    // The five oldest fell off the front; the newest is last.
    expect(kinds[0]).toBe("e5")
    expect(kinds.at(-1)).toBe(`e${PER_TASK_CAP + 4}`)
  })

  it("honours the recent() limit, returning the newest N", () => {
    const log = new EngineEventLog()
    for (let i = 0; i < 10; i++) log.append("t1", event(`e${i}`))
    expect(log.recent("t1", 3).map((e) => e.kind)).toEqual(["e7", "e8", "e9"])
  })

  it("evicts the least-recently-appended task, never an actively-appended one", () => {
    const log = new EngineEventLog()
    // Fill exactly to the ceiling: task-0 .. task-(CAP-1), oldest first.
    for (let i = 0; i < TASK_CAP; i++) log.append(`task-${i}`, event("seed"))

    // Re-touch task-0 — the one whose FIRST append was oldest. A FIFO-by-first
    // -seen buffer (the bug) would still evict it next; a recency LRU must not.
    log.append("task-0", event("active"))

    // A brand-new task pushes the map one over the ceiling, forcing one eviction.
    log.append("fresh", event("hello"))

    // task-0 survived because it was just touched; its feed is intact.
    expect(log.recent("task-0").map((e) => e.kind)).toEqual(["seed", "active"])
    // task-1 — now the least-recently-appended — is the one dropped.
    expect(log.recent("task-1")).toEqual([])
    // The newcomer is retained.
    expect(log.recent("fresh").map((e) => e.kind)).toEqual(["hello"])
  })

  it("clearTask drops one task's buffer without touching others", () => {
    const log = new EngineEventLog()
    log.append("t1", event("a"))
    log.append("t2", event("b"))
    log.clearTask("t1")
    expect(log.recent("t1")).toEqual([])
    expect(log.recent("t2").map((e) => e.kind)).toEqual(["b"])
  })
})
