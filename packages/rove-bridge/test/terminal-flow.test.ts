import { describe, expect, test, vi } from "bun:test"
import { FLOW_HIGH, TermFlow } from "../src/terminal-flow.ts"

const S = "task::tab-1"

/** A page-side double: what reached the page, in order, and a peek the test resolves by hand. */
function harness(stallMs?: number) {
  const page: string[] = []
  let answer: ((ring: { offset: number; data: string }) => void) | null = null
  let peeks = 0
  const flow = new TermFlow(
    {
      forward: (_s, data) => void page.push(data),
      reset: (_s, replay) => void page.push(`RESET:${replay}`),
      peek: () => {
        peeks++
        const pending = Promise.withResolvers<{ offset: number; data: string }>()
        answer = pending.resolve
        return pending.promise
      },
    },
    stallMs,
  )
  return {
    flow,
    page,
    peeks: () => peeks,
    resolvePeek: async (ring: { offset: number; data: string }) => {
      answer?.(ring)
      await Promise.resolve()
      await Promise.resolve()
    },
  }
}

/** One frame just over the watermark. */
const BIG = "x".repeat(FLOW_HIGH + 1)

describe("TermFlow", () => {
  test("a page that acks stops getting output past the watermark and is resynced once it catches up", async () => {
    const h = harness()
    h.flow.watch(S)
    h.flow.data(S, BIG, 100)
    h.flow.data(S, "dropped", 110)
    expect(h.page).toEqual([BIG])

    h.flow.ack(S, FLOW_HIGH)
    expect(h.peeks()).toBe(0)
    h.flow.ack(S, 1)
    expect(h.peeks()).toBe(1)

    // In flight with the peek: 120 is inside the ring's cut, 140 is past it.
    h.flow.data(S, "in-ring", 120)
    h.flow.data(S, "after-cut", 140)
    await h.resolvePeek({ offset: 130, data: "RING" })
    h.flow.data(S, "live", 150)

    expect(h.page).toEqual([BIG, "RESET:RING", "after-cut", "live"])
  })

  test("frames without a host offset pass straight through and are never held back", () => {
    const h = harness()
    h.flow.watch(S)
    h.flow.data(S, BIG, undefined)
    h.flow.data(S, "next", undefined)
    expect(h.page).toEqual([BIG, "next"])
  })

  test("a stream attached without acks is never flow-controlled", () => {
    const h = harness()
    h.flow.data(S, BIG, 100)
    h.flow.data(S, "next", 200)
    expect(h.page).toEqual([BIG, "next"])
  })

  test("a detach during the peek drops the resync", async () => {
    const h = harness()
    h.flow.watch(S)
    h.flow.data(S, BIG, 100)
    h.flow.ack(S, BIG.length)
    h.flow.forget(S)
    await h.resolvePeek({ offset: 100, data: "RING" })
    expect(h.page).toEqual([BIG])
  })

  test("a stream left behind with no acks resyncs on its own", async () => {
    vi.useFakeTimers()
    try {
      const h = harness(3000)
      h.flow.watch(S)
      h.flow.data(S, BIG, 100)
      // The page never acks (a dropped frame would leave chars it can never ack).
      vi.advanceTimersByTime(2999)
      expect(h.peeks()).toBe(0)
      vi.advanceTimersByTime(1)
      expect(h.peeks()).toBe(1)
      await h.resolvePeek({ offset: 100, data: "RING" })
      h.flow.data(S, "live", 110)
      expect(h.page).toEqual([BIG, "RESET:RING", "live"])
    } finally {
      vi.useRealTimers()
    }
  })
})
