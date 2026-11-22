/**
 * Width (in columns) below which the TUI shows one panel at a time.
 * `0` never switches; a width past any real terminal always does.
 */

export const NARROW_BELOW_KEY = "layout.narrowBelow"

export const DEFAULT_NARROW_BELOW = 70
export const NARROW_BELOW_MAX = 1000

/** Coerce a persisted value: garbage → default, out-of-range → clamped. */
export function normalizeNarrowBelow(value: unknown): number {
  const n =
    typeof value === "number"
      ? Math.floor(value)
      : typeof value === "string" && value.trim() !== ""
        ? Number(value.trim())
        : Number.NaN
  if (!Number.isFinite(n)) return DEFAULT_NARROW_BELOW
  return Math.min(NARROW_BELOW_MAX, Math.max(0, Math.floor(n)))
}
