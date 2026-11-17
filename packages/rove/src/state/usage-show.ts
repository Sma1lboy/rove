/**
 * Whether usage percentages (plan quota windows, context window) read as the
 * share used or the share left (Settings → General → Usage), kv-persisted.
 * Only the number flips: severity tones always follow the share used.
 */

export const USAGE_SHOW_KEY = "usage.show"

export type UsageShow = "used" | "left"

export const USAGE_SHOWS: readonly UsageShow[] = ["used", "left"]

export const DEFAULT_USAGE_SHOW: UsageShow = "used"

export function normalizeUsageShow(raw: unknown): UsageShow {
  return raw === "left" ? "left" : DEFAULT_USAGE_SHOW
}

/** The percent to print for a window `usedPercent` full; what is left never goes below 0. */
export function shownPercent(usedPercent: number, show: UsageShow): number {
  return show === "left" ? 100 - Math.min(100, Math.max(0, usedPercent)) : usedPercent
}
