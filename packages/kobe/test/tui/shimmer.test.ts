/**
 * Running-title shimmer: the band crosses every label at one speed in cells,
 * lights nothing outside itself, loops seamlessly, and leaves palette inks
 * unblended.
 */

import { RGBA } from "@opentui/core"
import { describe, expect, it } from "vitest"
import { normalizeRunningTitle } from "../../src/state/running-title"
import {
  SHIMMER_CELLS_PER_TICK,
  SHIMMER_HALF_WIDTH,
  shimmerInk,
  shimmerIntensity,
  shimmerLoop,
} from "../../src/tui/lib/shimmer"
import { SPINNER_TICK_CYCLE } from "../../src/tui/panes/sidebar/row-view"

/** Tick at which the band's crest sits on cell `index`, within the first sweep. */
function crestTick(index: number, cells: number): number {
  let best = 0
  for (let tick = 0; tick < shimmerLoop(cells) / SHIMMER_CELLS_PER_TICK; tick += 0.01) {
    if (shimmerIntensity(index, cells, tick) > shimmerIntensity(index, cells, best)) best = tick
  }
  return best
}

describe("shimmer", () => {
  it("moves the band the same cells per tick on a short and a long label", () => {
    for (const cells of [8, 60]) {
      const ticks = crestTick(6, cells) - crestTick(2, cells)
      expect(4 / ticks).toBeCloseTo(SHIMMER_CELLS_PER_TICK, 1)
    }
  })

  it("lights nothing beyond the band's edge", () => {
    const tick = crestTick(10, 30)
    expect(shimmerIntensity(10, 30, tick)).toBeCloseTo(1, 1)
    expect(shimmerIntensity(11 + SHIMMER_HALF_WIDTH, 30, tick)).toBe(0)
    expect(shimmerIntensity(9 - SHIMMER_HALF_WIDTH, 30, tick)).toBe(0)
    expect(shimmerIntensity(0, 30, 0)).toBe(0)
  })

  it("rests dark between sweeps, so neither the loop nor the tick wrap jumps the band", () => {
    for (const cells of [5, 23, 41]) {
      const lit = (tick: number) => Array.from({ length: cells }, (_, i) => shimmerIntensity(i, cells, tick))
      const loopTicks = shimmerLoop(cells) / SHIMMER_CELLS_PER_TICK
      expect(lit(loopTicks - 0.01).every((v) => v === 0)).toBe(true)
      // Mid-sweep: the shared counter wrapping to 0 lands exactly where it would have gone.
      const mid = crestTick(Math.floor(cells / 2), cells)
      const round = (vs: number[]) => vs.map((v) => v.toFixed(6))
      expect(round(lit(mid + SPINNER_TICK_CYCLE))).toEqual(round(lit(mid)))
    }
  })

  it("blends rgb inks and switches palette inks whole at the crest", () => {
    const muted = RGBA.fromInts(100, 100, 100)
    const accent = RGBA.fromInts(200, 120, 90)
    expect(shimmerInk(muted, accent, 0)).toBe(muted)
    expect(shimmerInk(muted, accent, 0.5).toInts()).toEqual([150, 110, 95, 255])
    const paletteMuted = RGBA.fromIndex(8)
    const paletteAccent = RGBA.fromIndex(3)
    expect(shimmerInk(paletteMuted, paletteAccent, 0.3)).toBe(paletteMuted)
    expect(shimmerInk(paletteMuted, paletteAccent, 1)).toBe(paletteAccent)
  })

  it("defaults the running title to shimmer and keeps an explicit still", () => {
    expect(normalizeRunningTitle(undefined)).toBe("shimmer")
    expect(normalizeRunningTitle("still")).toBe("still")
    expect(normalizeRunningTitle("sparkle")).toBe("shimmer")
  })
})
