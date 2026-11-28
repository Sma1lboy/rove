/**
 * Colorblind-friendly diff colour: `on` turns the added ink away from green
 * so added/removed stop being a red/green pair (`diffInks` in theme-core).
 */

export const COLORBLIND_KEY = "appearance.colorblind"

export const COLORBLIND_MODES = ["off", "on"] as const
export type ColorblindMode = (typeof COLORBLIND_MODES)[number]

export const DEFAULT_COLORBLIND: ColorblindMode = "off"

/** Coerce a persisted value; anything unrecognized → the default. */
export function normalizeColorblind(raw: unknown): ColorblindMode {
  return COLORBLIND_MODES.includes(raw as ColorblindMode) ? (raw as ColorblindMode) : DEFAULT_COLORBLIND
}
