/**
 * Parser for `rgb()` / `rgba()` literals, accepted wherever a theme JSON takes
 * `#hex`. Dependency-free so BOTH resolvers share one copy: `resolveTheme()`
 * (`../theme-core`, opentui `RGBA`) and `resolveThemeSlotHex()` (`./hex`,
 * `#rrggbb` for code that must not load the TUI runtime).
 *
 *     rgb(134, 225, 252)
 *     rgba(134, 225, 252, 0.5)
 *
 * Integer channels 0-255; alpha is a CSS 0-1 fraction; free whitespace. Comma
 * form only: CSS's space-separated form is rejected (one grammar, not two).
 * Out-of-range returns `null` rather than clamping: `rgb(300, 0, 0)` is a
 * hand-authored typo, and `validateTheme` names it instead of letting it fall
 * through to the def-name lookup and render black.
 */

/** A parsed literal. `a` is a 0-255 byte, already converted from CSS's 0-1. */
export type ColorLiteral = { r: number; g: number; b: number; a: number }

const RGB_RE = /^rgba?\(([^()]*)\)$/i

/** True if `s` LOOKS like an rgb()/rgba() literal, parseable or not. */
export function isRgbLiteral(s: string): boolean {
  return RGB_RE.test(s.trim())
}

function channel(part: string): number | null {
  if (!/^\d{1,3}$/.test(part)) return null
  const n = Number(part)
  return n <= 255 ? n : null
}

function alpha(part: string): number | null {
  if (!/^(?:0|1|0?\.\d+|1\.0+)$/.test(part)) return null
  return Math.round(Number(part) * 255)
}

/**
 * Parse `rgb(r, g, b)` / `rgba(r, g, b, a)`. Returns `null` for anything
 * else, including a well-shaped call with an out-of-range component.
 */
export function parseRgbLiteral(value: string): ColorLiteral | null {
  const m = RGB_RE.exec(value.trim())
  if (!m) return null
  const parts = (m[1] as string).split(",").map((p) => p.trim())
  if (parts.length !== 3 && parts.length !== 4) return null
  const r = channel(parts[0] as string)
  const g = channel(parts[1] as string)
  const b = channel(parts[2] as string)
  if (r === null || g === null || b === null) return null
  const a = parts.length === 4 ? alpha(parts[3] as string) : 255
  if (a === null) return null
  return { r, g, b, a }
}
