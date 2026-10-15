/** The prefix layer's shared state: the key, and what the HUD shows (TUI `prefix-hud.ts`). */

import { PREFIX_GUIDE_DELAY_MS, PREFIX_HUD_TTL_MS } from "@sma1lboy/rove/src/tui/lib/prefix-hud.ts"
import { createStore } from "./store.ts"

/** `DEFAULT_PREFIX_CONFIGURATION.key`. */
export const PREFIX_KEY = "ctrl+a"
/** `DEFAULT_PREFIX_CONFIGURATION.timeoutMs`. */
export const PREFIX_TIMEOUT_MS = 5000
/** Fast users finish inside this; learners then get the complete command map. */
export const GUIDE_DELAY_MS = PREFIX_GUIDE_DELAY_MS
/** A resolved line stays this long. */
export const HUD_TTL_MS = PREFIX_HUD_TTL_MS
/** The TUI keeps the last three. */
const MAX_ENTRIES = 3

export interface HudEntry {
  readonly id: number
  readonly stroke: string
  /** The TUI binding id it ran; null = a miss, drawn as `∅`. */
  readonly action: string | null
  readonly at: number
}

export interface HudState {
  /** `prefix`: armed, with the guide due after {@link GUIDE_DELAY_MS}. `direct`: Ctrl held. */
  readonly guide: { readonly kind: "prefix"; readonly armedAt: number } | { readonly kind: "direct" } | null
  readonly entries: readonly HudEntry[]
}

export const hud = createStore<HudState>({ guide: null, entries: [] })

let nextEntry = 1

export function hudPush(stroke: string, action: string | null): void {
  const entry = { id: nextEntry++, stroke, action, at: Date.now() }
  hud.set({ guide: null, entries: [...hud.get().entries, entry].slice(-MAX_ENTRIES) })
}
