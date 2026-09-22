/**
 * Counters + timers for the terminal streaming path, enabled by
 * `ROVE_RENDER_PROFILE=<path>` (JSON lines appended once a second). Off, each
 * call is one boolean test, so it can stay in hot paths. Writes to a FILE,
 * never stdout: a stray line there corrupts the frame being measured. Stages
 * are counted separately from the renderer's frame rate so the two compare:
 * producing snapshots faster than they're drawn is invisible per stage.
 */

const target = process.env.ROVE_RENDER_PROFILE
const renderProfileOn = Boolean(target)

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
