/**
 * Keystroke HUD feed — a tiny framework-free stream the dispatch layer
 * writes and the workspace overlay renders (bottom-left of the Tasks
 * sidebar). Carries resolved PureTUI prefix sequences AND direct modifier
 * chords (`prefixKey: ""`). Keeps the last three plus the active prefix or
 * direct-shortcut guide;
 * entries carry a timestamp and the OVERLAY enforces expiry, so this module
 * owns no timers and stays inert for headless/unit-test dispatch. It does own
 * the CLOCK those overlay timers read, so a render test can drive the delayed
 * reveal instead of racing a real setTimeout — see {@link setPrefixHudClock}.
 */

import { type ReadableState, createStateCell } from "../../lib/external-store"

/** How long a resolved line stays visible before the overlay flushes it. */
export const PREFIX_HUD_TTL_MS = 4000

/** Fast users finish inside this window; learners then get the complete command map. */
export const PREFIX_GUIDE_DELAY_MS = 180

const MAX_ENTRIES = 3

export type PrefixHudEntry = {
  id: number
  /** First stroke as displayed, e.g. `ctrl+a`. */
  prefixKey: string
  /** Second stroke as displayed, e.g. `t`. */
  stroke: string
  /** Resolved binding id (`tab.new`) — null when nothing was bound. */
  action: string | null
  at: number
}

export type PrefixHudSnapshot = {
  guide: PrefixHudGuide | null
  entries: readonly PrefixHudEntry[]
}

export type PrefixHudOption = {
  stroke: string
  action: string
}

type PrefixHudGuide =
  | {
      readonly kind: "prefix"
      readonly armedAt: number
      readonly options: readonly PrefixHudOption[]
    }
  | {
      readonly kind: "direct"
      readonly options: readonly PrefixHudOption[]
    }

/**
 * Clock the HUD overlay reads for `now` and for its expiry timers. Real
 * timers make the PREFIX_GUIDE_DELAY_MS reveal a race: the render suite
 * saturates the event loop, and the armed prefix cancels itself
 * DEFAULT_PREFIX_CONFIGURATION.timeoutMs after the tap, so a slipped timer
 * deletes the answer rather than merely delaying it. Tests swap in a manual
 * clock and advance it.
 */
export type PrefixHudClock = {
  now(): number
  /** Run `fn` after `ms`; returns a cancel function. */
  schedule(fn: () => void, ms: number): () => void
}

const realClock: PrefixHudClock = {
  now: () => Date.now(),
  schedule: (fn, ms) => {
    const timer = setTimeout(fn, ms)
    return () => clearTimeout(timer)
  },
}

let clock: PrefixHudClock = realClock

/** Clock the overlay must use for timestamps and expiry timers. */
export function prefixHudClock(): PrefixHudClock {
  return clock
}

/** Test seam — install a manual clock, or `null` to restore real time. */
export function setPrefixHudClock(next: PrefixHudClock | null): void {
  clock = next ?? realClock
}

const cell = createStateCell<PrefixHudSnapshot>({ guide: null, entries: [] })
let nextEntryId = 1

export const prefixHudState: ReadableState<PrefixHudSnapshot> = cell

export function prefixHudSetArmed(
  armed: boolean,
  options: readonly PrefixHudOption[] = [],
  armedAt: number | null = null,
): void {
  cell.update((current) => {
    if (!armed) return current.guide?.kind === "prefix" ? { ...current, guide: null } : current
    return { ...current, guide: { kind: "prefix", armedAt: armedAt ?? clock.now(), options } }
  })
}

export function prefixHudShowDirect(options: readonly PrefixHudOption[]): void {
  cell.update((current) => ({ ...current, guide: { kind: "direct", options } }))
}

export function prefixHudHideDirect(): void {
  cell.update((current) => (current.guide?.kind === "direct" ? { ...current, guide: null } : current))
}

export function prefixHudPush(entry: Omit<PrefixHudEntry, "id">): void {
  cell.update((current) => ({
    ...current,
    guide: null,
    entries: [...current.entries, { ...entry, id: nextEntryId++ }].slice(-MAX_ENTRIES),
  }))
}

/** Test seam — clears the feed between unit tests. */
export function resetPrefixHud(): void {
  cell.set({ guide: null, entries: [] })
}
