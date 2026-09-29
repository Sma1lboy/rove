/**
 * A light that travels around a box border: comets run clockwise, the head in
 * the accent, the tail turning hue toward a partner colour as it fades into
 * the resting border. Pure — the caller paints the returned inks per cell.
 */

import type { RGBA } from "@opentui/core"
import { mixInk, turnHue } from "./breathe"

/** Head advance per shared spinner tick (80ms): ~31 cells/s. */
export const FLOW_CELLS_PER_TICK = 2.5
/** Comets spaced evenly around the loop, so a long border never goes dark for long. */
const COMETS = 2
const MAX_TAIL = 36
/** Tail end's hue turn: orange heads trail through rose into violet. */
const TAIL_HUE_DEG = -90
const LEVELS = 24
const HEAD_LIFT = 0.3

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

/** 1 at a comet's head, falling off quadratically along its tail, 0 elsewhere. */
export function flowIntensity(index: number, loop: number, tick: number): number {
  if (loop === 0) return 0
  const tail = Math.min(MAX_TAIL, Math.floor(loop / (COMETS * 1.5)))
  const spacing = loop / COMETS
  const head = (tick * FLOW_CELLS_PER_TICK) % loop
  let best = 0
  for (let c = 0; c < COMETS; c++) {
    const behind = (head + c * spacing - index + 2 * loop) % loop
    if (behind < tail) best = Math.max(best, (1 - behind / tail) ** 2)
  }
  return best
}

/**
 * Inks by intensity step: 0 is the resting border, the last step the head.
 * Cached per colour set — the palette is fixed while the theme is.
 */
export function flowPalette(accent: RGBA, resting: RGBA): readonly RGBA[] {
  const key = `${accent.toInts().join()}|${resting.toInts().join()}`
  const hit = paletteCache.get(key)
  if (hit) return hit
  const steps = Array.from({ length: LEVELS + 1 }, (_, i) => {
    const k = i / LEVELS
    // The head outshines the accent; the tail keeps its colour longer than its light.
    return mixInk(turnHue(accent, TAIL_HUE_DEG * (1 - k), 0.95 + HEAD_LIFT * k), resting, k ** 0.6)
  })
  paletteCache.set(key, steps)
  return steps
}

const paletteCache = new Map<string, readonly RGBA[]>()

export function flowInk(palette: readonly RGBA[], intensity: number): RGBA | undefined {
  if (intensity <= 0) return undefined
  return palette[Math.round(intensity * LEVELS)]
}
