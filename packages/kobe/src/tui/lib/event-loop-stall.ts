/**
 * Event-loop stall telemetry: a 1s heartbeat measures wall-clock drift, and a
 * late beat's gap IS the stall. The log line carries heap numbers to tell a
 * JS-blocked loop (a Rove bug) from a paged-out process (OS memory pressure):
 *   - big gap + rss far above heapUsed → swapped/paged (OS)
 *   - big gap + heapUsed near rss      → in-process work; `sample` the pid
 *     during the next stall for the stack
 */
import { logClient } from "@sma1lboy/kobe-daemon/client/client-log"

export const STALL_HEARTBEAT_MS = 1000
export const STALL_THRESHOLD_MS = 2000

/** Pure decision + message builder, unit-testable without timers. */
export function stallReport(
  gapMs: number,
  mem: { rss: number; heapUsed: number },
  heartbeatMs: number = STALL_HEARTBEAT_MS,
  thresholdMs: number = STALL_THRESHOLD_MS,
): string | null {
  const stallMs = gapMs - heartbeatMs
  if (stallMs < thresholdMs) return null
  const mb = (n: number) => Math.round(n / 1048576)
  return `event loop stalled ~${stallMs}ms — rss=${mb(mem.rss)}MB heapUsed=${mb(mem.heapUsed)}MB`
}

/** Returns a stop function; the timer is unref'd so it never keeps a dying host alive. */
export function installEventLoopStallTelemetry(): () => void {
  let last = Date.now()
  const timer = setInterval(() => {
    const now = Date.now()
    const gap = now - last
    last = now
    const report = stallReport(gap, process.memoryUsage())
    if (report) logClient("stall", report)
  }, STALL_HEARTBEAT_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}
