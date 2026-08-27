/**
 * Stepwise coarse buckets for a relative-time delta: minutes from the raw
 * millisecond delta, hours from minutes, days from hours. Both TUI consumers
 * (the Routines schedule preview's `formatRelative` and the Automations
 * page's `formatWhen`) derive their units from here so the two can't drift
 * apart again — they used to be independent copies, which is how one screen
 * ended up proposing floor while its neighbor rounded (PR #479).
 *
 * Every step uses Math.round — the behavior both consumers shipped with.
 * Floor-vs-round is a display-convention call the owner makes (PR #479
 * argues countdowns should floor so they never overstate headroom); when
 * that's decided, change it HERE so every consumer moves together.
 */
export function relativeBuckets(absMs: number): { minutes: number; hours: number; days: number } {
  const minutes = Math.round(absMs / 60_000)
  const hours = Math.round(minutes / 60)
  return { minutes, hours, days: Math.round(hours / 24) }
}
