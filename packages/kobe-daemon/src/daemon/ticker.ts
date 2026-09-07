/**
 * The shared skeleton behind every daemon background loop.
 *
 * Each `start*` collector re-implemented the same parts by hand: a
 * `tickMs <= 0` no-op guard, a reentrancy flag, an optional subscriber gate, a
 * `setInterval`, `timer.unref?.()`, a `logDaemonError(<scope>, err)` catch, and
 * a `clearInterval` teardown. The guard line alone appeared verbatim in five
 * files — and its ABSENCE from `quota-resume` and `quota-usage-cache` meant a
 * zero there armed a hot loop instead of disabling the poll.
 *
 * The seam: this module owns WHEN a pass may run; each collector owns what a
 * pass does. The per-key adaptive backoff in `poll-scheduling.ts` is the inner
 * loop and stays there. `activity-observer.ts` stays hand-rolled — it counts
 * ticks and walks every Nth, which needs options nobody else uses.
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
  /** Checked before EVERY pass, the immediate one included. Omitted means
   *  ungated — the deliberate setting for the sweeps whose whole job is
   *  running while nobody is attached. Never default one on. */
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
    // A SYNCHRONOUS pass is already finished here, so it must not arm the
    // reentrancy flag — `quota-usage-cache` and the two collectors never had
    // one, and giving them one would drop a tick whenever the flag outlived
    // the pass. Only a pass that returns a promise gets guarded, which is
    // exactly the shape the other five hand-rolled.
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
