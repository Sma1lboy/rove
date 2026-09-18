/**
 * Parser for the `rgb()` / `rgba()` colour literals a theme JSON may use
 * anywhere a `#hex` is accepted.
 *
 * Deliberately dependency-free — no `@opentui/core`, no regex helpers — so
 * BOTH colour resolvers can share it: `resolveTheme()` in `../theme-core`
 * (returns opentui `RGBA`) and `resolveThemeSlotHex()` in `./hex` (returns a
 * plain `#rrggbb` string for CLI / external-styling code that must not drag
 * in the TUI runtime). A second copy in either one is how the two drift.
 *
 * Syntax accepted, comma-separated only:
 *
 *     rgb(134, 225, 252)
 *     rgba(134, 225, 252, 0.5)
 *
 * Channels are integers 0-255. Alpha follows CSS: a 0-1 fraction, not a byte.
 * Whitespace around any component is free. CSS's space-separated form
 * (`rgb(134 225 252)`) is NOT accepted — nothing needs it yet, and rejecting
 * it keeps the grammar one shape instead of two.
 *
 * Out-of-range components return `null` rather than clamping the way CSS
 * does. A theme file is authored by hand, and `rgb(300, 0, 0)` is a typo the
 * author wants to hear about — `validateTheme` turns that `null` into a named
 * rejection instead of letting the value fall through to the def-name lookup
 * and collapse to black.
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
