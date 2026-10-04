/**
 * Breathing spinner: the running glyph's speed and accent follow one cycle.
 * Pins what a viewer sees: no jump when the shared tick wraps, a visibly
 * slower exhale than inhale, and palette-indexed inks left untouched.
 */

import { RGBA } from "@opentui/core"
import { describe, expect, it } from "vitest"
import { DEFAULT_SPINNER_FRAMES } from "../../src/engine/spinner-frames"
import { BREATH_TICKS, breathColor, breathGlyph } from "../../src/tui/lib/breathe"
import { SPINNER_TICK_CYCLE } from "../../src/tui/panes/sidebar/row-view"

const frames = DEFAULT_SPINNER_FRAMES

/** Ticks each glyph is held for across one breath, in order. */
function dwells(): number[] {
  const out: number[] = []
  let run = 1
  for (let tick = 1; tick <= BREATH_TICKS; tick++) {
    if (breathGlyph(frames, tick) === breathGlyph(frames, tick - 1)) run++
    else {
      out.push(run)
      run = 1
    }
  }
  return out
}

describe("breathing spinner", () => {
  it("wraps the shared tick cycle without a glyph jump", () => {
    expect(SPINNER_TICK_CYCLE % BREATH_TICKS).toBe(0)
    expect(breathGlyph(frames, SPINNER_TICK_CYCLE)).toBe(breathGlyph(frames, 0))
    expect(breathGlyph(frames, BREATH_TICKS)).toBe(breathGlyph(frames, 0))
  })

  it("holds glyphs longer on the exhale than at the peak", () => {
    const held = dwells()
    expect(Math.max(...held)).toBeGreaterThanOrEqual(4)
    expect(Math.min(...held)).toBe(1)
  })

  it("fades the accent toward muted at the bottom and reaches it at the peak", () => {
    const accent = RGBA.fromInts(204, 120, 92)
    const muted = RGBA.fromInts(100, 100, 100)
    expect(breathColor(accent, muted, BREATH_TICKS / 2).toInts()).toEqual(accent.toInts())
    expect(breathColor(accent, muted, 0).toInts()).not.toEqual(accent.toInts())
  })

  it("passes a palette-indexed accent through unmixed", () => {
    const indexed = RGBA.fromIndex(3)
    expect(breathColor(indexed, RGBA.fromInts(100, 100, 100), 0)).toBe(indexed)
  })
})
