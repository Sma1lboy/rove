/**
 * A row's status as a 3×3 dot mark, after ELYTerminal's session orb (MIT, `src/sessions/orb.rs`):
 * which look a status takes, each settled look's shape, and the clock work and waiting move on.
 * Every mark steps on one 80 ms clock: work ripples out from the centre as a cosine, a wait dips
 * twice per round, a settled state draws its shape dot by dot and holds. The web draws each dot at
 * its level; the terminal lights the dots above a threshold (`tui/lib/status-dots.ts`).
 */

export type DotLook = "working" | "waiting" | "error" | "done" | "idle"

/** A daemon row status as a look; none (no reading yet) is a quiet row. A rate limit clears itself, so it waits rather than fails. */
export function dotLook(status: { readonly kind: string; readonly reason?: string } | undefined): DotLook {
  switch (status?.kind) {
    case "busy":
    case "running":
      return "working"
    case "needs-input":
      return "waiting"
    case "attention":
      return status.reason === "rate_limited" ? "waiting" : "error"
    case "unseen":
      return "done"
    default:
      return "idle"
  }
}

/** A settled look's dots (row by row from the top left) in the order they light: a cross, a tick, a ring. */
export const DOT_SHAPE = {
  error: [0, 4, 8, 2, 6],
  done: [3, 7, 5, 2],
  idle: [1, 2, 5, 8, 7, 6, 3, 0],
} as const satisfies Partial<Record<DotLook, readonly number[]>>

/** The clock every mark steps on. */
export const STEP_MS = 80
/** One ripple of a working mark, in seconds. */
export const RIPPLE_S = 1.2
/** Steps in one round of a waiting mark, and the steps of it the mark dips on: twice, early. */
export const BLINK_STEPS = 20
const DIP_STEPS: readonly number[] = [0, 1, 4, 5]

/** Whether a waiting mark is in a dip at clock `step`. */
export function waitingDips(step: number): boolean {
  return DIP_STEPS.includes(((Math.floor(step) % BLINK_STEPS) + BLINK_STEPS) % BLINK_STEPS)
}

/** How far a dot one dot out from the centre lags the ripple, in seconds. */
const LAG = 0.3
/** A working dot at its lowest, a waiting mark in a dip, and a dot outside a settled shape. */
export const DIM = 0.35
const DIP = 0.25
const FAINT = 0.12
/** Steps a settled shape's dot takes to light, and between one dot and the next. */
const FADE = 2
const STAGGER = 1

/** A settled look's dots in the order they light, and how bright they end. */
const SHAPE: Partial<Record<DotLook, { readonly dots: readonly number[]; readonly bright: number }>> = {
  error: { dots: DOT_SHAPE.error, bright: 1 },
  done: { dots: DOT_SHAPE.done, bright: 1 },
  idle: { dots: DOT_SHAPE.idle, bright: 0.6 },
}

/** Each dot's distance from the centre: 0, 1 for an edge, √2 for a corner. */
const DISTANCE = Array.from({ length: 9 }, (_, dot) => Math.hypot((dot % 3) - 1, Math.floor(dot / 3) - 1))

/** A dot's brightness `t` seconds into its ripple. */
function crest(t: number): number {
  return DIM + (1 - DIM) * (0.5 + 0.5 * Math.cos((2 * Math.PI * t) / RIPPLE_S))
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
      const dip = waitingDips(step / slow)
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
