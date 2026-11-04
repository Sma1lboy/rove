import { describe, expect, it } from "vitest"
import { UPDATE_DELAY_KEY, updateDelayHours } from "../../src/state/update-channel.ts"

describe("update.delayHours", () => {
  it("reads a hand-edited value, and anything unusable as no delay", () => {
    expect(updateDelayHours({ [UPDATE_DELAY_KEY]: 48 })).toBe(48)
    for (const bad of [undefined, "24", -5, Number.NaN, Number.POSITIVE_INFINITY, null]) {
      expect(updateDelayHours({ [UPDATE_DELAY_KEY]: bad })).toBe(0)
    }
  })
})
