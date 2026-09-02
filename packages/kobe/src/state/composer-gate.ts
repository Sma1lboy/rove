/**
 * The composer-empty delivery gate's off switch.
 *
 * Before pasting a peer/API prompt into a running engine, Rove renders that
 * session's screen and refuses when the composer already holds text — so a
 * message never lands in the middle of what someone is typing. That check
 * reads the engine's CURRENT layout through an `EngineScreenManifest`, which
 * is a rule about pixels an upstream vendor is free to change without telling
 * anyone. When Claude moved its composer behind three rows of status
 * furniture, the rule stopped matching and every delivery to every Claude task
 * was held (2026-09-01).
 *
 * The detector is now conservative in the right direction — an unmatched
 * anchor answers "I can't see it" rather than "there is text" — but the
 * failure mode this switch exists for is the one that comes back: a vendor
 * moves, the gate is confidently wrong, and the user watches messages queue up
 * with no way to say "I know, send it anyway". Turning this off drops the
 * SCREEN check only; the recent-keystroke window still protects a composer
 * someone is actively typing into, because that one measures time rather than
 * reading a layout.
 *
 * Lives in shared state.json (the Settings dialog's KV writes the same file)
 * and is read fresh at each delivery, so toggling needs no restart — the
 * dispatcher-flag precedent. ON by default: this is an escape hatch, not a
 * preference.
 */

import { getPersistedBool } from "./store.ts"

export const COMPOSER_GATE_KEY = "delivery.composerGate"

export interface ComposerGatePreferenceStore {
  get(key: string, fallback?: unknown): unknown
  set(key: string, value: unknown): void
  flush(): boolean
}

export function composerGatePreferenceOn(store: ComposerGatePreferenceStore): boolean {
  return store.get(COMPOSER_GATE_KEY, true) !== false
}

/** Toggle the persisted gate and notify only after an on-to-off edge is durable. */
export function toggleComposerGatePreference(
  store: ComposerGatePreferenceStore,
  onDisabled?: () => void,
): "enabled" | "disabled" | "persist-failed" {
  const next = !composerGatePreferenceOn(store)
  store.set(COMPOSER_GATE_KEY, next)
  if (next) return "enabled"
  // KV writes are normally debounced. Flush before notifying the daemon so
  // its fresh state.json read cannot race this transition and see the old ON.
  if (!store.flush()) return "persist-failed"
  onDisabled?.()
  return "disabled"
}

/** Whether the screen-based composer check runs. Default true. */
export function composerGateEnabled(): boolean {
  return getPersistedBool(COMPOSER_GATE_KEY, true)
}
