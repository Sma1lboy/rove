import { describe, expect, test } from "vitest"
import { formatBytes } from "../../src/lib/format-bytes.ts"

describe("formatBytes", () => {
  test("picks a sane unit", () => {
    expect(formatBytes(340)).toBe("340 B")
    expect(formatBytes(1536)).toBe("1.5 KB")
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MB")
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3.0 GB")
  })

  test("drops the decimal once the value reaches 100", () => {
    expect(formatBytes(100 * 1024)).toBe("100 KB")
    expect(formatBytes(128 * 1024)).toBe("128 KB")
  })

  test("a quotient that rounds up to 100 renders as an integer, not 100.0", () => {
    // 99.9502 KB: below 100 raw, but toFixed(1) rounds it to "100.0" — a
    // three-digit magnitude with a decimal, exactly what the >= 100 branch kills.
    expect(formatBytes(102349)).toBe("100 KB")
    // Same edge one unit up (99.95 MB) must behave identically.
    expect(formatBytes(Math.round(99.96 * 1024 * 1024))).toBe("100 MB")
    // Just under the round-up point still keeps its decimal.
    expect(formatBytes(102297)).toBe("99.9 KB")
  })

  test("promotes at the unit boundary instead of rendering 1024", () => {
    // The bug this helper exists to kill: doctor's old copy compared the raw
    // value against the threshold before rounding and printed "1024.0 KB".
    // v rounds up to 1024 KB → must roll over to 1.0 MB, not "1024 KB".
    expect(formatBytes(1024 * 1024 - 512)).toBe("1.0 MB")
    expect(formatBytes(1024 * 1024 - 1)).toBe("1.0 MB")
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB")
    expect(formatBytes(1024 * 1024 * 1024 - 1)).toBe("1.0 GB")
    // Just below the round-up threshold stays in the smaller unit.
    expect(formatBytes(1024 * 1024 - 513)).toBe("1023 KB")
  })
})
