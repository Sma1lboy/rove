/**
 * The footer's context-window chip (`contextChip`) — the pure half of the
 * `ctx 62%` meter. What matters here is the three REFUSALS: the chip must not
 * invent a denominator it was not given, because a percentage of a guessed
 * window is a made-up number wearing a tone colour.
 */

import { describe, expect, test } from "vitest"
import { contextChip } from "../../src/tui-react/component/settings-dialog/usage-core"

describe("contextChip", () => {
  test("absent data renders nothing — three ways", () => {
    expect(contextChip(undefined)).toBeNull()
    expect(contextChip(null)).toBeNull()
    // Claude reports context_tokens but no window. A percentage would need a
    // denominator the neutral layer is not allowed to guess.
    expect(contextChip({ contextTokens: 120_000 })).toBeNull()
    expect(contextChip({ contextTokens: 1, contextWindowTokens: 0 })).toBeNull()
  })

  test("an engine-reported reading is an exact percent, tone by fullness", () => {
    expect(contextChip({ contextTokens: 124_000, contextWindowTokens: 200_000 })).toEqual({
      label: "ctx",
      percentText: "62%",
      resetText: "",
      tone: "ok",
    })
    expect(contextChip({ contextTokens: 160_000, contextWindowTokens: 200_000 })?.tone).toBe("warn")
    expect(contextChip({ contextTokens: 195_000, contextWindowTokens: 200_000 })?.tone).toBe("crit")
  })

  test("an ESTIMATED reading is suffixed, so it never reads as engine-reported", () => {
    expect(contextChip({ contextTokens: 100_000, contextWindowTokens: 200_000, approximate: true })).toEqual({
      label: "ctx",
      percentText: "50%~",
      resetText: "",
      tone: "ok",
    })
  })

  test("a prompt over the advertised window reads as full, not 103%", () => {
    // Tool definitions and the system prompt can push the reported figure past
    // the vendor's own advertised number.
    expect(contextChip({ contextTokens: 210_000, contextWindowTokens: 200_000 })?.percentText).toBe("100%")
    expect(contextChip({ contextTokens: -5, contextWindowTokens: 200_000 })?.percentText).toBe("0%")
  })
})
