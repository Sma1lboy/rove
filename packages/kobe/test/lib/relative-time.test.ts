import { describe, expect, test } from "vitest"
import { relativeAge, relativeBuckets } from "../../src/lib/relative-time.ts"

const MIN = 60_000
const NOW = Date.parse("2026-07-27T12:00:00.000Z")

describe("relativeBuckets", () => {
  test("steps minutes → hours → days from one delta", () => {
    expect(relativeBuckets(15 * MIN)).toEqual({ minutes: 15, hours: 0, days: 0 })
    expect(relativeBuckets(23 * 60 * MIN)).toEqual({ minutes: 23 * 60, hours: 23, days: 0 })
    expect(relativeBuckets(3 * 24 * 60 * MIN)).toMatchObject({ hours: 72, days: 3 })
  })

  test("each step FLOORS, so a countdown never overstates headroom", () => {
    // The two cases the decision turned on: a routine 1h40m out used to read
    // `in 2h` and fire twenty minutes early, and 36h out used to read `in 2d`.
    expect(relativeBuckets(100 * MIN).hours).toBe(1)
    expect(relativeBuckets(36 * 60 * MIN).days).toBe(1)
    expect(relativeBuckets(90 * MIN).hours).toBe(1)
    expect(relativeBuckets(119 * MIN).hours).toBe(1)
    expect(relativeBuckets(120 * MIN).hours).toBe(2)
    // A sub-minute event is "now", not "1m ago" — the widened window that
    // makes the Routines run list agree with the inbox's `45s`.
    expect(relativeBuckets(59_999).minutes).toBe(0)
    expect(relativeBuckets(60_000).minutes).toBe(1)
  })
})

describe("relativeAge", () => {
  test("steps through seconds, minutes, hours, and days", () => {
    expect(relativeAge(NOW - 3_000, NOW)).toBe("3s")
    expect(relativeAge(NOW - 5 * 60_000, NOW)).toBe("5m")
    expect(relativeAge(NOW - 3 * 3_600_000, NOW)).toBe("3h")
    expect(relativeAge(NOW - 2 * 86_400_000, NOW)).toBe("2d")
  })

  test("clamps a clock-skewed future stamp to 0s", () => {
    expect(relativeAge(NOW + 5000, NOW)).toBe("0s")
  })

  test("reads the same instant as the bucket consumers do", () => {
    // The bug this file's single ownership closes: the routines run list read
    // `2m ago` for the event the inbox called `1m`.
    expect(relativeAge(NOW - 100_000, NOW)).toBe("1m")
    expect(relativeAge(NOW - 100 * MIN, NOW)).toBe("1h")
  })
})
