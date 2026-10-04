import { describe, expect, it } from "vitest"
import {
  DEFAULT_PREFIX_TAP_PRESENTATION,
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
})
