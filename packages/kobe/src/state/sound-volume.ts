/**
 * Notification chime volume (Settings → General → Sound), separate from the
 * on/off toggle. Read at play time, so a change applies to the next chime.
 *
 * Linear amplitude 0..1, applied to the WAV samples (`tui/lib/wav-volume.ts`)
 * because `afplay`, `aplay`, `omxplayer` and Windows' `Media.SoundPlayer`
 * accept no volume argument.
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

/** The step after `volume` — the nearest step at or below it, then one along, wrapping. */
export function nextSoundVolume(volume: number): number {
  const current = normalizeSoundVolume(volume)
  const at = SOUND_VOLUME_STEPS.findIndex((step) => step >= current - 1e-9)
  return SOUND_VOLUME_STEPS[(at < 0 ? 0 : at + 1) % SOUND_VOLUME_STEPS.length] as number
}

/** Framework-free read for the sound layer — kv writes land in the same state.json. */
export function persistedSoundVolume(): number {
  return normalizeSoundVolume(loadStateFile()[SOUND_VOLUME_KEY])
}
