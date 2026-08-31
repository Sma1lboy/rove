import { describe, expect, it } from "vitest"
import {
  formatTokens,
  type EngineUsageSnapshot,
  summarizeUsage,
} from "../src/lib/history.ts"

/**
 * The transcript header renders the reader's neutral usage snapshot — the
 * adapter owns every derivation (session totals, what counts as "context").
 * The client only unpacks the snapshot, and treats its ABSENCE ("engine
 * doesn't report usage", e.g. kimi's unverified wire) as "render no chips",
 * never as zero — the same honesty as read-output's `engine_unsupported`.
 */

describe("summarizeUsage", () => {
  it("unpacks the engine-neutral snapshot verbatim — no client-side math", () => {
    const snapshot: EngineUsageSnapshot = {
      input_tokens: 300,
      output_tokens: 60,
      cache_read_input_tokens: 1005,
      cache_creation_input_tokens: 50,
      context_tokens: 1250,
      context_tokens_approximate: true,
    }
    expect(summarizeUsage(snapshot)).toEqual({
      inputTokens: 300,
      outputTokens: 60,
      contextTokens: 1250,
    })
  })

  it("engine-reported context (copilot) passes through without approximation", () => {
    const snapshot: EngineUsageSnapshot = {
      input_tokens: 10,
      output_tokens: 5,
      context_tokens: 42,
    }
    const out = summarizeUsage(snapshot)
    expect(out.contextTokens).toBe(42)
  })

  it("undefined means \"not reported\" — zeros for display, so chips gate off", () => {
    expect(summarizeUsage(undefined)).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      contextTokens: 0,
    })
  })

  it("a snapshot without context_tokens yields a zero context display", () => {
    const snapshot: EngineUsageSnapshot = { input_tokens: 10, output_tokens: 5 }
    expect(summarizeUsage(snapshot).contextTokens).toBe(0)
  })
})

describe("formatTokens", () => {
  it("formats with k/m suffixes", () => {
    expect(formatTokens(0)).toBe("0")
    expect(formatTokens(999)).toBe("999")
    expect(formatTokens(1_500)).toBe("1.5k")
    expect(formatTokens(42_000)).toBe("42.0k")
    expect(formatTokens(2_300_000)).toBe("2.3m")
  })

  it("switches suffix at the EXACT threshold (>=, not >)", () => {
    // The boundary is the bit a `>` refactor would silently break: 999 stays
    // raw and 1000 is already "1.0k".
    expect(formatTokens(999)).toBe("999")
    expect(formatTokens(1_000)).toBe("1.0k")
  })

  it("promotes to m once the k rendering would round up to 1000.0", () => {
    // 999,950 is where value/1000 rounds to "1000.0" at one decimal — from
    // there on the value must render as "1.0m", never "1000.0k".
    expect(formatTokens(999_949)).toBe("999.9k")
    expect(formatTokens(999_950)).toBe("1.0m")
    expect(formatTokens(999_999)).toBe("1.0m")
    expect(formatTokens(1_000_000)).toBe("1.0m")
  })
})
