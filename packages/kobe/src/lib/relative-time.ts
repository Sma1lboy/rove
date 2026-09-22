/**
 * The product's one relative-time clock: coarse buckets for a millisecond
 * delta, and the compact `3m` / `2h` / `4d` label built on them. Every TUI age
 * or countdown derives its units here, so two screens never disagree.
 *
 * Every step FLOORS: rounding up overstates a countdown (1h40m would read
 * `in 2h`), and a 45-second-old event is not `1m ago`.
 */
export function relativeBuckets(absMs: number): { minutes: number; hours: number; days: number } {
  const minutes = Math.floor(absMs / 60_000)
  const hours = Math.floor(minutes / 60)
  return { minutes, hours, days: Math.floor(hours / 24) }
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
