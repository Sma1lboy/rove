/**
 * A colour gradient that flows around a box border: every border cell takes
 * its ink from a looping accent → partner → accent ramp, and the ramp slides
 * clockwise with the shared tick. Pure — the caller paints the inks per cell.
 */

import type { RGBA } from "@opentui/core"
import { turnHue } from "./breathe"

/** Ramp advance per shared spinner tick (80ms): ~31 cells/s. */
export const FLOW_CELLS_PER_TICK = 2.5
/** Times the ramp repeats per lap, so a long border shows every colour at once. */
const WAVES = 3
/** Partner hue: orange accents flow through magenta and violet into blue. */
const PARTNER_HUE_DEG = -160
const LEVELS = 48

/** Offsets of a `width`×`height` box's border cells, clockwise from the top-left corner. */
export function perimeter(width: number, height: number): ReadonlyArray<readonly [number, number]> {
  if (width < 2 || height < 2) return []
  const cells: Array<readonly [number, number]> = []
  for (let x = 0; x < width; x++) cells.push([x, 0])
  for (let y = 1; y < height; y++) cells.push([width - 1, y])
  for (let x = width - 2; x >= 0; x--) cells.push([x, height - 1])
  for (let y = height - 2; y > 0; y--) cells.push([0, y])
  return cells
}

/** Where border cell `index` sits on the ramp at `tick`, in [0, 1). */
export function flowPhase(index: number, loop: number, tick: number): number {
  if (loop === 0) return 0
  const phase = ((index - tick * FLOW_CELLS_PER_TICK) * WAVES) / loop
  return ((phase % 1) + 1) % 1
}

/** The ramp, sampled; cached per accent since it only changes with the theme. */
export function flowPalette(accent: RGBA): readonly RGBA[] {
  const key = accent.toInts().join()
  const hit = paletteCache.get(key)
  if (hit) return hit
  const steps = Array.from({ length: LEVELS }, (_, i) => {
    // 0 at the accent, 1 at the partner, back to 0: a seamless loop.
    const away = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / LEVELS)
    return turnHue(accent, PARTNER_HUE_DEG * away, 1.18 - 0.28 * away, 1.3)
  })
  paletteCache.set(key, steps)
  return steps
}

const paletteCache = new Map<string, readonly RGBA[]>()

export function flowInk(palette: readonly RGBA[], phase: number): RGBA | undefined {
  return palette[Math.round(phase * palette.length) % palette.length]
}
