import { afterEach, beforeEach, describe, expect, test, vi } from "bun:test"
import { type HitState, type Reply, hitSearch } from "../src/search-hits.ts"

const reply = (title: string): Reply => ({
  matches: [{ taskId: title, title, role: "user", at: "2026-11-05T00:00:00Z", snippet: title }],
  skipped: [],
  truncated: false,
})

describe("rail conversation search", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test("a slow reply for an older query never replaces the newer one", async () => {
    const pending = new Map<string, { promise: Promise<Reply>; resolve: (r: Reply) => void }>()
    const seen: HitState[] = []
    const search = hitSearch(
      (q) => {
        const slot = Promise.withResolvers<Reply>()
        pending.set(q, slot)
        return slot.promise
      },
      (state) => seen.push(state),
      300,
    )
    search.run("old")
    vi.advanceTimersByTime(300)
    search.run("new")
    vi.advanceTimersByTime(300)
    const fresh = pending.get("new")
    const stale = pending.get("old")
    fresh?.resolve(reply("new"))
    await fresh?.promise
    stale?.resolve(reply("old"))
    await stale?.promise
    const done = seen.filter((s) => s.kind === "done")
    expect(done).toHaveLength(1)
    expect(done[0]?.kind === "done" && done[0].query).toBe("new")
  })

  test("typing on inside the debounce asks once, and under two characters asks nothing", () => {
    const asked: string[] = []
    const search = hitSearch(
      async (q) => {
        asked.push(q)
        return reply(q)
      },
      () => {},
      300,
    )
    search.run("ab")
    vi.advanceTimersByTime(100)
    search.run("abc")
    vi.advanceTimersByTime(300)
    search.run("a")
    vi.advanceTimersByTime(300)
    expect(asked).toEqual(["abc"])
  })
})
