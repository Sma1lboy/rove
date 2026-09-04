/**
 * The product's one relative-time clock: coarse buckets for a millisecond
 * delta, and the compact `3m` / `2h` / `4d` label built on them. Every TUI
 * surface that prints an age or a countdown derives its units here — the
 * Routines schedule preview (`formatRelative`), the Automations page
 * (`formatWhen`), the attention inbox, the worktrees page, the issue event
 * list, and the plugins section — so two screens cannot disagree about the
 * same instant.
 *
 * Every step FLOORS. Two reasons the rounding variant lost: a countdown that
 * rounds up overstates headroom (a routine 1h40m out rendered `in 2h` and
 * then fired twenty minutes early), and `relativeAge`'s seconds step has no
 * rounding rule anyone wants (a 45-second-old event is not `1m ago`). Flooring
 * makes both read early rather than late.
 */
export function relativeBuckets(absMs: number): { minutes: number; hours: number; days: number } {
  const minutes = Math.floor(absMs / 60_000)
  const hours = Math.floor(minutes / 60)
  return { minutes, hours, days: Math.floor(hours / 24) }
}

/** Time REMAINING until an epoch-ms deadline ("3m", "2h", "4d"); a deadline
 *  already past clamps to "0s". {@link relativeAge} run backwards, so a
 *  queue's age column and its deadline cannot disagree about what an hour
 *  looks like — and the flip is written down here once rather than at each
 *  call site, where it reads as a trick. */
export function relativeCountdown(deadlineMs: number, nowMs: number = Date.now()): string {
  return relativeAge(nowMs, deadlineMs)
}

/** Relative age of an epoch-ms timestamp ("3m", "2h", "4d"); negative deltas clamp to "0s". */
export function relativeAge(ms: number, nowMs: number = Date.now()): string {
  const delta = Math.max(0, nowMs - ms)
  const secs = Math.floor(delta / 1000)
  if (secs < 60) return `${secs}s`
  const { minutes, hours, days } = relativeBuckets(delta)
  if (minutes < 60) return `${minutes}m`
  if (hours < 24) return `${hours}h`
  return `${days}d`
}
