/**
 * Flowing border gradient: every border cell is inked exactly once per frame,
 * the ramp slides clockwise, and its colours loop without a seam.
 */

import { RGBA } from "@opentui/core"
import { describe, expect, it } from "vitest"
import { normalizeWorkingBorder } from "../../src/state/working-border"
import { FLOW_CELLS_PER_TICK, flowInk, flowPalette, flowPhase, perimeter } from "../../src/tui/lib/border-flow"

describe("border flow", () => {
  it("walks each border cell of a box once, clockwise from the top-left", () => {
    const cells = perimeter(6, 4)
    expect(cells).toHaveLength(2 * 6 + 2 * 4 - 4)
    expect(new Set(cells.map(([x, y]) => `${x},${y}`)).size).toBe(cells.length)
    expect(cells.slice(0, 7)).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
      [5, 0],
      [5, 1],
    ])
  })

  it("slides the ramp clockwise: a colour sits one step further along each tick", () => {
    const loop = 300
    expect(flowPhase(10, loop, 0)).toBeCloseTo(flowPhase(10 + FLOW_CELLS_PER_TICK * 4, loop, 4))
  })

  it("ramps away from the accent and back, so the loop has no seam", () => {
    const accent = RGBA.fromInts(204, 120, 92)
    const palette = flowPalette(accent)
    const first = flowInk(palette, 0)?.toInts()
    const justBefore = flowInk(palette, 0.999)?.toInts()
    expect(justBefore).toEqual(first)
    expect(flowInk(palette, 0.5)?.toInts()).not.toEqual(first)
  })

  it("defaults the working border to flow and keeps an explicit still", () => {
    expect(normalizeWorkingBorder(undefined)).toBe("flow")
    expect(normalizeWorkingBorder("still")).toBe("still")
    expect(normalizeWorkingBorder("sparkle")).toBe("flow")
  })
})
