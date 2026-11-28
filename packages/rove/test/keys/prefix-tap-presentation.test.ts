import { normalizePrefixTapPresentation } from "@sma1lboy/rove-client/keys/prefix-tap-presentation.ts"
import { describe, expect, it } from "vitest"

describe("prefix tap presentation", () => {
  it("defaults missing, malformed, and unknown values to local entries", () => {
    expect(normalizePrefixTapPresentation(undefined)).toBe("local")
    expect(normalizePrefixTapPresentation(null)).toBe("local")
    expect(normalizePrefixTapPresentation(42)).toBe("local")
    expect(normalizePrefixTapPresentation("old-value")).toBe("local")
  })
})
