/**
 * Kimi StopFailure → the neutral failure class.
 *
 * Kimi fires StopFailure, but an adapter returning no detail for
 * `turn-failed` leaves `reduceActivity` with `failure: undefined`, so every
 * Kimi failure — the 5-hour quota wall included — reduces to a generic
 * `error`. Kimi could then never reach `rate_limited`, and so never arm the
 * auto-resume that state triggers.
 *
 * The payload shapes below are Kimi's own (verified against the installed
 * 0.37.2 binary): `error_type` is a JS CLASS name, not a category, and the
 * `[provider.*]` code lives in the message.
 *
 * Mutation target is the PIPELINE, not the classifier: these assert the
 * reduced STATE, so deleting the `turn-failed` branch in the adapter turns
 * them red even though `kimiFailureDetail` itself still passes its own tests.
 */
import { describe, expect, it } from "vitest"
import { reduceActivity } from "../../src/engine/hook-events"
import { KimiHookAdapter } from "../../src/engine/kimi-local/hook-adapter"

const adapter = new KimiHookAdapter()
const stateFor = (payload: Record<string, unknown>) =>
  reduceActivity("running", "turn-failed", adapter.activityDetailFromPayload("turn-failed", payload))

describe("kimi turn-failed classification", () => {
  it("reaches rate_limited for a provider rate limit", () => {
    expect(stateFor({ error_type: "APIProviderRateLimitError", error_message: "[provider.rate_limit] 429" })).toBe(
      "rate_limited",
    )
  })

  it("reaches rate_limited for quota exhaustion, which rides a 429 under a different code", () => {
    // `APIProviderQuotaExhaustedError` is coded `provider.api_error`, so the
    // class name is the only thing that distinguishes it from a plain error.
    expect(
      stateFor({ error_type: "APIProviderQuotaExhaustedError", error_message: "[provider.api_error] quota" }),
    ).toBe("rate_limited")
  })

  it("treats the 5-hour usage wall (a 403 auth error) as needing a human, not a timer", () => {
    // The literal wall message. Kimi files it under auth; it is a quota
    // wall, so it is `billing` — attention, but deliberately NOT auto-resumed.
    const detail = adapter.activityDetailFromPayload("turn-failed", {
      error_type: "APIStatusError",
      error_message: "[provider.auth_error] 403 You've reached your 5-hour usage limit.",
    })
    expect(detail?.failure).toBe("billing")
    expect(reduceActivity("running", "turn-failed", detail)).toBe("rate_limited")
  })

  it("still reduces an ordinary failure to error", () => {
    expect(stateFor({ error_type: "TypeError", error_message: "boom" })).toBe("error")
    expect(stateFor({})).toBe("error")
  })

  it("keeps the vendor error class as a note for diagnostics", () => {
    expect(adapter.activityDetailFromPayload("turn-failed", { error_type: "APIProviderRateLimitError" })?.note).toBe(
      "APIProviderRateLimitError",
    )
  })
})
