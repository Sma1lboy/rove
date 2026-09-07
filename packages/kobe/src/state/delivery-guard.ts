/**
 * The delivery gate's off switch, in three states.
 *
 * Before pasting a peer/API prompt into a running engine, Rove runs two
 * independent checks so a message never lands in the middle of what someone is
 * typing:
 *
 * - **A, the keystroke window** — someone wrote to that pty by hand less than
 *   `humanWriteQuietMs` ago. Measures TIME, so it is right about every engine.
 * - **B, the screen read** — the composer already holds text, decided from the
 *   engine's CURRENT layout through an `EngineScreenManifest`. That is a rule
 *   about pixels an upstream vendor is free to change without telling anyone:
 *   a vendor moving its composer stops the rule matching, and every delivery to
 *   every task on that engine is held.
 *
 * `on` runs both (the default). `screen-off` drops B only — the escape hatch
 * for a vendor redesign, and what the old `delivery.composerGate=false` meant.
 * `off` drops both, leaving only the bare-shell check (`sessionHasEngine`);
 * this is the setting for a fleet nobody is typing into, where a held message
 * is worse than a collided one.
 *
 * Lives in shared state.json (the Settings dialog's KV writes the same file)
 * and is read fresh at each delivery, so changing it needs no restart — the
 * A layer included, which is why the quiet window is resolved HERE and not
 * from the pty host's `KOBE_PTY_HUMAN_WRITE_QUIET_MS` (host env, fixed at
 * spawn, `rove reset` to change).
 */

import { readRoveEnv } from "@sma1lboy/kobe-daemon/compat-env"
import { loadStateFile } from "./store.ts"

export const DELIVERY_GUARD_KEY = "delivery.guard"
/** Pre-three-state boolean. `false` meant "screen read off"; still honored. */
export const LEGACY_COMPOSER_GATE_KEY = "delivery.composerGate"

export const DELIVERY_GUARDS = ["on", "screen-off", "off"] as const
export type DeliveryGuard = (typeof DELIVERY_GUARDS)[number]

/** Which of the two checks a guard setting runs. */
export interface DeliveryGuardLayers {
  /** A: block while the human's last keystroke is inside the quiet window. */
  readonly humanWrite: boolean
  /** B: block when the engine's composer is rendering text. */
  readonly screen: boolean
}

export function deliveryGuardLayers(guard: DeliveryGuard): DeliveryGuardLayers {
  return { humanWrite: guard !== "off", screen: guard === "on" }
}

function asGuard(value: unknown): DeliveryGuard | undefined {
  return typeof value === "string" && (DELIVERY_GUARDS as readonly string[]).includes(value)
    ? (value as DeliveryGuard)
    : undefined
}

/** `ROVE_DELIVERY_GUARD`, when it names a real state. Wins over the stored value. */
export function deliveryGuardEnvOverride(env: NodeJS.ProcessEnv = process.env): DeliveryGuard | undefined {
  return asGuard(readRoveEnv("DELIVERY_GUARD", env)?.trim())
}

/**
 * Resolve the effective guard from raw stored values. Pure — the store-shaped
 * and file-shaped readers below both funnel through it, and so do the tests.
 */
export function resolveDeliveryGuard(raw: unknown, legacy: unknown, env?: NodeJS.ProcessEnv): DeliveryGuard {
  const override = deliveryGuardEnvOverride(env)
  if (override) return override
  const stored = asGuard(raw)
  if (stored) return stored
  // The old boolean only ever said "skip the screen read"; `true`/absent is
  // the default. A garbage value is not a third opinion — fall back to `on`.
  return legacy === false ? "screen-off" : "on"
}

export interface DeliveryGuardPreferenceStore {
  get(key: string, fallback?: unknown): unknown
  set(key: string, value: unknown): void
  flush(): boolean
}

/** The Settings dialog's view of the setting (kv-backed). */
export function deliveryGuardPreference(store: DeliveryGuardPreferenceStore): DeliveryGuard {
  return resolveDeliveryGuard(store.get(DELIVERY_GUARD_KEY), store.get(LEGACY_COMPOSER_GATE_KEY))
}

/**
 * Persist a chosen state, notifying only after a LOOSENING edge is durable —
 * the daemon's deferred queue is drained on that edge, and an in-progress
 * flush reads this value between records, so tightening back to `on` is its
 * cancellation signal just as loosening starts it.
 */
export function setDeliveryGuardPreference(
  store: DeliveryGuardPreferenceStore,
  next: DeliveryGuard,
  onLoosened?: () => void,
): "saved" | "persist-failed" {
  const previousGuard = store.get(DELIVERY_GUARD_KEY)
  const previousLegacy = store.get(LEGACY_COMPOSER_GATE_KEY)
  store.set(DELIVERY_GUARD_KEY, next)
  // Clear the superseded boolean so the two keys cannot disagree on disk.
  store.set(LEGACY_COMPOSER_GATE_KEY, undefined)
  if (!store.flush()) {
    // Restore BOTH: the old boolean is what the effective value falls back to
    // when the new key was never set, so leaving it deleted would silently
    // loosen the guard on a write that did not land.
    store.set(DELIVERY_GUARD_KEY, previousGuard)
    store.set(LEGACY_COMPOSER_GATE_KEY, previousLegacy)
    return "persist-failed"
  }
  if (next !== "on") onLoosened?.()
  return "saved"
}

/** Next state in `on → screen-off → off → on` order (the row's enter action). */
export function nextDeliveryGuard(current: DeliveryGuard): DeliveryGuard {
  return DELIVERY_GUARDS[(DELIVERY_GUARDS.indexOf(current) + 1) % DELIVERY_GUARDS.length] ?? "on"
}

export interface DeliveryGuardSettings {
  readonly guard: DeliveryGuard
  /**
   * Quiet window for the A layer, in ms. Undefined leaves the pty host's own
   * reported value in charge; a stored number overrides it without a restart.
   */
  readonly humanWriteQuietMs?: number
}

export const HUMAN_WRITE_QUIET_MS_KEY = "delivery.humanWriteQuietMs"

/** One state-file read for both delivery decisions (the write path is hot). */
export function deliveryGuardSettings(): DeliveryGuardSettings {
  const state = loadStateFile()
  const quiet = state[HUMAN_WRITE_QUIET_MS_KEY]
  return {
    guard: resolveDeliveryGuard(state[DELIVERY_GUARD_KEY], state[LEGACY_COMPOSER_GATE_KEY]),
    ...(typeof quiet === "number" && Number.isFinite(quiet) && quiet >= 0 ? { humanWriteQuietMs: quiet } : {}),
  }
}

/** Fresh effective state, for the daemon's between-records queue check. */
export function deliveryGuard(): DeliveryGuard {
  return deliveryGuardSettings().guard
}
