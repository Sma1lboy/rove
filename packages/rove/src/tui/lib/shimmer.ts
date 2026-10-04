/**
 * A light band sweeping across a running label, after oh-my-pi's shimmer
 * (MIT, © Mario Zechner, Can Bölük): the band travels at a FIXED speed in
 * cells, so short and long labels sweep at the same pace, with a cosine
 * brightness profile and a quiet gap before the next sweep. Pure, driven by
 * the shared spinner tick.
 */

import type { RGBA } from "@opentui/core"
import { SPINNER_TICK_CYCLE } from "../panes/sidebar/row-view"
import { mixInk } from "./breathe"

/** 30 cells/s at the shared 80ms tick. */
export const SHIMMER_CELLS_PER_TICK = 2.4
/** Cells from the band's centre to where it fades to nothing. */
export const SHIMMER_HALF_WIDTH = 5
/** Dark cells travelled between one sweep leaving and the next arriving. */
const QUIET_CELLS = 24
/** Intensity at and above which a cell is the crest: bold, and the full accent on palette inks. */
export const SHIMMER_CREST = 0.65

// Integer cells travelled per SPINNER_TICK_CYCLE; sweeps loop on a divisor of
// it, so the tick counter wrapping never jumps the band mid-label.
const CYCLE_CELLS = Math.round(SPINNER_TICK_CYCLE * SHIMMER_CELLS_PER_TICK)

/** Cells one sweep plus its quiet gap spans, for a label of `cells`. */
export function shimmerLoop(cells: number): number {
  let loop = cells + 2 * SHIMMER_HALF_WIDTH + QUIET_CELLS
  while (CYCLE_CELLS % loop !== 0 && loop < CYCLE_CELLS) loop++
  return loop
}

/** Brightness of cell `index` (0…1) in a `cells`-wide label at `tick`. */
export function shimmerIntensity(index: number, cells: number, tick: number): number {
  const loop = shimmerLoop(cells)
  const centre = ((tick * SHIMMER_CELLS_PER_TICK) % loop) - SHIMMER_HALF_WIDTH
  const dist = Math.abs(index + 0.5 - centre)
  if (dist >= SHIMMER_HALF_WIDTH) return 0
  return 0.5 + 0.5 * Math.cos((Math.PI * dist) / SHIMMER_HALF_WIDTH)
}

/** The ink for a cell at `intensity`; palette inks can't blend, so they switch at the crest. */
export function shimmerInk(muted: RGBA, accent: RGBA, intensity: number): RGBA {
  if (intensity <= 0) return muted
  if (muted.intent !== "rgb" || accent.intent !== "rgb") return intensity >= SHIMMER_CREST ? accent : muted
  return mixInk(accent, muted, intensity)
}
