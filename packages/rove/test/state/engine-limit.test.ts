import { normalizeMaxLiveEngines } from "@sma1lboy/rove-core/state/engine-limit.ts"
import { describe, expect, it } from "vitest"

describe("normalizeMaxLiveEngines", () => {
  it("reads a positive whole number, typed or hand-edited as a string", () => {
    expect(normalizeMaxLiveEngines(4)).toBe(4)
    expect(normalizeMaxLiveEngines(" 6 ")).toBe(6)
  })

  it.each([undefined, null, 0, -2, 2.5, "", "lots", true])("treats %j as no cap rather than a cap of zero", (value) => {
    expect(normalizeMaxLiveEngines(value)).toBeUndefined()
  })
})
