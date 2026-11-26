/**
 * A row's status as a 3×3 dot mark, after ELYTerminal's session orb (MIT, `src/sessions/orb.rs`):
 * which look a status takes, each settled look's shape, and the clock work and waiting move on.
 * The web fades each dot (`rove-web/src/dot-levels.ts`); the terminal lights or drops it
 * (`tui/lib/status-dots.ts`). Both read this, so the two marks keep one shape and one beat.
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
