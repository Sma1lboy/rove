/**
 * Env-gated counters + timers for the terminal streaming path.
 *
 * `ROVE_RENDER_PROFILE=<path>` turns it on and names a file to append JSON
 * lines to, one per second. Off (the default) every call is a single boolean
 * test — the whole point is to be able to leave it in a hot path.
 *
 * It writes to a FILE and never to stdout: stdout belongs to the renderer, and
 * a stray line there corrupts the frame it is trying to measure.
 *
 * What it answers: how many times per second each stage of "PTY bytes → drawn
 * frame" actually runs, and how long each takes. The stages are counted
 * separately from the renderer's own frame rate precisely so the two can be
 * compared — producing snapshots faster than they are drawn is invisible in
 * any single-stage measurement.
 */

const target = process.env.ROVE_RENDER_PROFILE
export const renderProfileOn = Boolean(target)

const counts = new Map<string, number>()
const totals = new Map<string, number>()
let started = 0

function flush(): void {
  if (counts.size === 0) return
  const row: Record<string, number> = { sec: Math.round((Date.now() - started) / 1000) }
  for (const [k, n] of counts) {
    row[`${k}_n`] = n
    const ms = totals.get(k)
    if (ms !== undefined) row[`${k}_ms`] = +ms.toFixed(3)
  }
  counts.clear()
  totals.clear()
  try {
    // Late require: nothing here may load in a process that has the profile off.
    require("node:fs").appendFileSync(target as string, `${JSON.stringify(row)}\n`)
  } catch {
    /* profiling must never take the TUI down */
  }
}

if (renderProfileOn) {
  started = Date.now()
  const timer = setInterval(flush, 1000)
  // Never hold the process open just to report on it.
  ;(timer as unknown as { unref?: () => void }).unref?.()
}

/** Count one occurrence of `stage`. */
export function profileTick(stage: string): void {
  if (!renderProfileOn) return
  counts.set(stage, (counts.get(stage) ?? 0) + 1)
}

/** Run `fn`, counting it and accumulating its wall time under `stage`. */
export function profileSpan<T>(stage: string, fn: () => T): T {
  if (!renderProfileOn) return fn()
  const t0 = performance.now()
  try {
    return fn()
  } finally {
    counts.set(stage, (counts.get(stage) ?? 0) + 1)
    totals.set(stage, (totals.get(stage) ?? 0) + (performance.now() - t0))
  }
}
