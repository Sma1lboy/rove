import { describe, expect, it } from "vitest"
import {
  DEFAULT_PREFIX_TAP_PRESENTATION,
  PREFIX_TAP_PRESENTATION_KEY,
  normalizePrefixTapPresentation,
} from "../../src/tui/lib/prefix-tap-presentation"

describe("prefix tap presentation", () => {
  it("defaults missing, malformed, and unknown values to local entries", () => {
    expect(DEFAULT_PREFIX_TAP_PRESENTATION).toBe("local")
    expect(normalizePrefixTapPresentation(undefined)).toBe("local")
    expect(normalizePrefixTapPresentation(null)).toBe("local")
    expect(normalizePrefixTapPresentation(42)).toBe("local")
    expect(normalizePrefixTapPresentation("old-value")).toBe("local")
  })

  it("accepts only the two persisted presentation values", () => {
    expect(PREFIX_TAP_PRESENTATION_KEY).toBe("hints.keyboard.prefixTapPresentation")
    expect(normalizePrefixTapPresentation("local")).toBe("local")
    expect(normalizePrefixTapPresentation("guide")).toBe("guide")
  })
})
