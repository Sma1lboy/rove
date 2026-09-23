/**
 * Counters + timers for performance measurement, enabled by
 * `ROVE_RENDER_PROFILE=<path>` (JSON lines appended once a second, each
 * stamped with wall-clock `t` so a driver can attribute rows to its own
 * phases). Off, each call is one boolean test, so it can stay in hot paths.
 * Writes to a FILE, never stdout: a stray line there corrupts the frame being
 * measured. Stages are counted separately from the renderer's frame rate so
 * the two compare: producing snapshots faster than they're drawn is invisible
 * per stage.
 */

const target = process.env.ROVE_RENDER_PROFILE
export const renderProfileOn = Boolean(target)

const counts = new Map<string, number>()
const totals = new Map<string, number>()
let started = 0

function append(row: Record<string, number | string>): void {
  try {
    // Late require: nothing here may load in a process that has the profile off.
    require("node:fs").appendFileSync(target as string, `${JSON.stringify(row)}\n`)
  } catch {
    /* profiling must never take the TUI down */
  }
}

function flush(): void {
  if (counts.size === 0) return
  const row: Record<string, number> = {
    t: Date.now(),
    pid: process.pid,
    sec: Math.round((Date.now() - started) / 1000),
  }
  for (const [k, n] of counts) {
    row[`${k}_n`] = n
    const ms = totals.get(k)
    if (ms !== undefined) row[`${k}_ms`] = +ms.toFixed(3)
  }
  counts.clear()
  totals.clear()
  append(row)
}

if (renderProfileOn) {
  started = Date.now()
  const timer = setInterval(flush, 1000)
  // Never hold the process open just to report on it.
  ;(timer as unknown as { unref?: () => void }).unref?.()
}

/** Count `n` occurrences of `stage`. */
export function profileTick(stage: string, n = 1): void {
  if (!renderProfileOn) return
  counts.set(stage, (counts.get(stage) ?? 0) + n)
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

const marked = new Set<string>()

/** Record, once per process, when `name` first happened: ms since process start. */
export function profileMark(name: string): void {
  if (!renderProfileOn || marked.has(name)) return
  marked.add(name)
  append({ t: Date.now(), pid: process.pid, mark: name, ms: +performance.now().toFixed(1) })
}
