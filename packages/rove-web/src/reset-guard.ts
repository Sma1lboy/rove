/** F5 replaces a pane's shell: the old process ending is the reset, not the pane or tab ending. */

const resetting = new Set<string>()

/** The old session's exit can land just after the reset's reply. */
export const RESET_GRACE_MS = 2000

export function beginReset(stream: string): void {
  resetting.add(stream)
}

/** The reset is over; exits are real again once the grace window has passed. */
export function endReset(stream: string, graceMs: number = RESET_GRACE_MS): void {
  setTimeout(() => resetting.delete(stream), graceMs)
}

export const exitIsReset = (stream: string): boolean => resetting.has(stream)
