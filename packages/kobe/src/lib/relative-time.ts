/**
 * Stepwise coarse buckets for a relative-time delta: minutes from the raw
 * millisecond delta, hours from minutes, days from hours. Both TUI consumers
 * (the Routines schedule preview's `formatRelative` and the Automations
 * page's `formatWhen`) derive their units from here so the two can't drift
 * apart — independent copies are how one screen ends up flooring while its
 * neighbor rounds.
 *
 * Every step uses Math.round. Floor-vs-round is a display-convention call
 * (a countdown that floors never overstates headroom); when
 * that's decided, change it HERE so every consumer moves together.
 */
export function relativeBuckets(absMs: number): { minutes: number; hours: number; days: number } {
  const minutes = Math.round(absMs / 60_000)
  const hours = Math.round(minutes / 60)
  return { minutes, hours, days: Math.round(hours / 24) }
}
