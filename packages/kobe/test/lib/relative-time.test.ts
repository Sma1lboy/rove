import { describe, expect, test } from "vitest"
import { relativeBuckets } from "../../src/lib/relative-time.ts"

const MIN = 60_000

describe("relativeBuckets", () => {
  test("steps minutes → hours → days from one delta", () => {
    expect(relativeBuckets(15 * MIN)).toEqual({ minutes: 15, hours: 0, days: 0 })
    expect(relativeBuckets(23 * 60 * MIN)).toEqual({ minutes: 23 * 60, hours: 23, days: 1 })
    expect(relativeBuckets(3 * 24 * 60 * MIN)).toMatchObject({ hours: 72, days: 3 })
  })

  test("each step ROUNDS — the behavior both consumers shipped with", () => {
    // Pinned so the two callers can't drift apart again. Whether these should
    // floor instead (a countdown that never overstates headroom — PR #479's
    // argument) is an owner call; flipping it here moves every consumer.
    expect(relativeBuckets(90 * MIN).hours).toBe(2) // 1h30m rounds up
    expect(relativeBuckets(89 * MIN).hours).toBe(1)
    expect(relativeBuckets(36 * 60 * MIN).days).toBe(2) // 1d12h rounds up
    expect(relativeBuckets(29_999).minutes).toBe(0) // <30s is "now" territory
    expect(relativeBuckets(30_000).minutes).toBe(1)
  })
})
