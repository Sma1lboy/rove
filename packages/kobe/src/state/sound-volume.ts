/**
 * Notification chime volume (Settings → General → Sound).
 *
 * Its own preference because the on/off toggle
 * (`notifications.sound.enabled`) is the wrong knob for "this is too loud":
 * the chime was audible or silent, nothing between. kv-persisted and read
 * framework-free at play time (`tui/lib/sound.ts`), so a change applies to
 * the next chime with no restart.
 *
 * The value is a linear amplitude scale, 0..1 — it is applied to the WAV's
 * samples rather than passed to the player, because four of the players the
 * chime can land on (`afplay`, `aplay`, `omxplayer`, and Windows'
 * `Media.SoundPlayer`) accept no volume argument at all. See
 * `tui/lib/wav-volume.ts`.
 */

import { loadStateFile } from "./store"

export const SOUND_VOLUME_KEY = "notifications.sound.volume"

export const DEFAULT_SOUND_VOLUME = 0.4

/**
 * The volumes the Settings row cycles through. The default is a member, so
 * cycling always returns to the shipped level rather than stranding it.
 */
export const SOUND_VOLUME_STEPS: readonly number[] = [0.1, 0.25, 0.4, 0.6, 0.8, 1]

/** Coerce a persisted value to a 0..1 scale (garbage → default, out of range → clamped). */
export function normalizeSoundVolume(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value.trim()) : Number.NaN
  if (!Number.isFinite(n)) return DEFAULT_SOUND_VOLUME
  return Math.min(1, Math.max(0, n))
}

/**
 * The step after `volume` — the nearest step at or BELOW it, then one along,
 * wrapping.
 *
 * `findLastIndex(step <= current)`, not `findIndex(step >= current)`: a value
 * that sits between steps (a hand-edited `0.5`, say) already makes the
 * `>=` search land on the next step up, so the `+ 1` then advanced a second
 * time and skipped a step — cycling from `0.5` jumped to `0.8`, and `0.6` was
 * unreachable. Anchoring on the step at or below `current` advances by exactly
 * one from every input. A `current` below the first step (or the silent `0`)
 * finds nothing (`-1`) and the wrap lands on the quietest step.
 */
export function nextSoundVolume(volume: number): number {
  const current = normalizeSoundVolume(volume)
  const at = SOUND_VOLUME_STEPS.findLastIndex((step) => step <= current + 1e-9)
  return SOUND_VOLUME_STEPS[(at < 0 ? 0 : at + 1) % SOUND_VOLUME_STEPS.length] as number
}

/** Framework-free read for the sound layer — kv writes land in the same state.json. */
export function persistedSoundVolume(): number {
  return normalizeSoundVolume(loadStateFile()[SOUND_VOLUME_KEY])
}
