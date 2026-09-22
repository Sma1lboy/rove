/**
 * The shared skeleton behind every daemon background loop: this owns WHEN a
 * pass may run (disable guard, reentrancy, gate, unref, error log, teardown);
 * each collector owns what a pass does. Per-key backoff stays in
 * `poll-scheduling.ts`; `activity-observer.ts` stays hand-rolled (it walks
 * every Nth tick).
 */

import { logDaemonError } from "./crash-log.ts"

function isThenable(value: unknown): value is Promise<unknown> {
  return typeof (value as { then?: unknown } | null | undefined)?.then === "function"
}

export interface TickerOptions {
  /** `logDaemonError` scope, grepped in `daemon.log` during triage — verbatim. */
  readonly name: string
  /** `<= 0` disables the ticker entirely: no interval, and no immediate pass. */
  readonly tickMs: number
  /** Checked before EVERY pass, the immediate one included. Omitted = ungated,
   *  deliberate for sweeps that must run while nobody is attached. */
  readonly gate?: () => boolean
  /** Run one pass before arming the interval (restart seeding). */
  readonly immediate?: boolean
  /** One pass. A returned promise is awaited and its value discarded. */
  readonly run: () => unknown
  /** Extra teardown beside `clearInterval` — the collectors' `stop()`. */
  readonly onStop?: () => void
}

export function startTicker(opts: TickerOptions): () => Promise<void> {
  if (opts.tickMs <= 0) return async () => {}
  let running: Promise<void> | null = null
  let stopped = false
  const tick = (): void => {
    if (stopped || (opts.gate && !opts.gate())) return
    if (running) return
    let result: unknown
    try {
      result = opts.run()
    } catch (err) {
      logDaemonError(opts.name, err)
      return
    }
    // A synchronous pass is already finished, so only a promise-returning
    // pass arms the reentrancy flag.
    if (!isThenable(result)) return
    running = Promise.resolve(result)
      .then(() => undefined)
      .catch((err: unknown) => logDaemonError(opts.name, err))
      .finally(() => {
        running = null
      })
  }
  if (opts.immediate) tick()
  const timer = setInterval(tick, opts.tickMs)
  // Without unref a gui-less daemon never exits and `rove daemon restart` hangs.
  timer.unref?.()
  return async () => {
    try {
      if (!stopped) {
        stopped = true
        clearInterval(timer)
        opts.onStop?.()
      }
    } finally {
      await running
    }
  }
}
