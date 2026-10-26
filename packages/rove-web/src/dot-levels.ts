/**
 * Each dot's opacity in a status mark, ported from ELYTerminal's orb (MIT, `src/sessions/orb.rs`):
 * every mark steps on one 80 ms clock, work ripples out from the centre as a cosine, a wait
 * dips twice per round, a settled state draws its shape dot by dot and holds.
 */

import type { DotLook } from "./rail-glyphs.ts"

export const STEP_MS = 80

/** One ripple in seconds, and how far a dot one dot out from the centre lags it. */
const RIPPLE = 1.2
const LAG = 0.3
/** Steps in one round of a waiting mark's dips. */
const BLINK = 20
/** A working dot at its lowest, a waiting mark in a dip, and a dot outside a settled shape. */
const DIM = 0.35
const DIP = 0.25
const FAINT = 0.12
/** Steps a settled shape's dot takes to light, and between one dot and the next. */
const FADE = 2
const STAGGER = 1

/** A settled look's dots (row by row from the top left) in the order they light, and how bright they end. */
const SHAPE: Partial<Record<DotLook, { readonly dots: readonly number[]; readonly bright: number }>> = {
  error: { dots: [0, 4, 8, 2, 6], bright: 1 },
  done: { dots: [3, 7, 5, 2], bright: 1 },
  idle: { dots: [1, 2, 5, 8, 7, 6, 3, 0], bright: 0.6 },
}

/** Each dot's distance from the centre: 0, 1 for an edge, √2 for a corner. */
const DISTANCE = Array.from({ length: 9 }, (_, dot) => Math.hypot((dot % 3) - 1, Math.floor(dot / 3) - 1))

/** A dot's brightness `t` seconds into its ripple. */
function crest(t: number): number {
  return DIM + (1 - DIM) * (0.5 + 0.5 * Math.cos((2 * Math.PI * t) / RIPPLE))
}

/**
 * The nine opacities of `look` at clock `step`, `held` steps after the look began. `slow` stretches
 * work and waiting in time (reduced motion) without stopping them.
 */
export function dotLevels(look: DotLook, step: number, held: number, slow = 1): number[] {
  switch (look) {
    case "working": {
      const t = (step * STEP_MS) / 1000 / slow
      return DISTANCE.map((distance) => crest(t - distance * LAG))
    }
    case "waiting": {
      const dip = [0, 1, 4, 5].includes(Math.floor(step / slow) % BLINK)
      return new Array<number>(9).fill(dip ? DIP : 1)
    }
    default: {
      const shape = SHAPE[look]
      const levels = new Array<number>(9).fill(FAINT)
      shape?.dots.forEach((dot, rank) => {
        const lit = Math.min(Math.max(held - rank * STAGGER, 0), FADE) / FADE
        levels[dot] = shape.bright * lit + FAINT * (1 - lit)
      })
      return levels
    }
  }
}

/** Whether a mark still changes `held` steps after its look began: work and waiting always, a settled shape until it is drawn. */
export function dotsMove(look: DotLook, held: number): boolean {
  const shape = SHAPE[look]
  return !shape || held < (shape.dots.length - 1) * STAGGER + FADE
}
