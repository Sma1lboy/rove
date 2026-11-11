/** The wall's one clock: every tile reads the same looping time, so the whole wall repeats seamlessly. */

import { useSyncExternalStore } from "react"

export const INTRO = 1400
export const LOOP = 8000
/** Tiles re-render on this beat; CSS transitions carry the motion between beats. */
const BEAT = 40

const subs = new Set<() => void>()
let beat = 0
/** The first painted frame: the opening and the loop count from it, not from page load. */
let epoch = -1
function frame(): void {
  if (epoch < 0) epoch = performance.now()
  const next = Math.floor((performance.now() - epoch) / BEAT)
  if (next !== beat) {
    beat = next
    for (const f of subs) f()
  }
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

const subscribe = (f: () => void) => {
  subs.add(f)
  return () => subs.delete(f)
}

/** Milliseconds into the loop, shifted by `offset` so tiles do not all move on the same beat. */
export function useT(offset = 0): number {
  const b = useSyncExternalStore(subscribe, () => beat)
  const t = b * BEAT - INTRO
  return t < 0 ? 0 : (t + offset) % LOOP
}

/** The value of the last step at or before `t`. */
export function at<T>(t: number, steps: readonly (readonly [number, T])[]): T {
  let value = (steps[0] as readonly [number, T])[1]
  for (const [time, v] of steps) if (t >= time) value = v
  return value
}

/** `text` as typed so far: one character every `ms` from `start`. */
export const typed = (text: string, t: number, start: number, ms = 45): string =>
  text.slice(0, Math.max(0, Math.floor((t - start) / ms)))
