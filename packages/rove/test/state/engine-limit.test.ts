import { describe, expect, it } from "vitest"
import { normalizeMaxLiveEngines } from "../../src/state/engine-limit.ts"

describe("normalizeMaxLiveEngines", () => {
  it("reads a positive whole number, typed or hand-edited as a string", () => {
    expect(normalizeMaxLiveEngines(4)).toBe(4)
    expect(normalizeMaxLiveEngines(" 6 ")).toBe(6)
  })

  it("treats anything else as no cap rather than a cap of zero", () => {
    for (const value of [undefined, null, 0, -2, 2.5, "", "lots", true]) {
      expect(normalizeMaxLiveEngines(value)).toBeUndefined()
    }
  })
})
