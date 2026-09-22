/**
 * Opentui-free hex resolver for theme slots. `resolveTheme()` (theme-core.ts)
 * returns `@opentui/core` RGBA, which CLI / external-styling code must not
 * load; this resolves one slot to `#rrggbb` with the same semantics (def
 * refs, slot refs, `{dark,light}`, circular-ref protection), except that
 * unresolvable / circular / transparent return `null` instead of black:
 * for external styling, skipping beats painting black.
 */

import type { ThemeJson } from "../theme-core"
import { type ColorLiteral, parseRgbLiteral } from "./color-literal"

type Variant = { dark: string; light: string }
type ColorValue = string | Variant

/** `#abc` expanded, `#rrggbbaa` alpha stripped, lowercased; `null` if malformed. */
export function normalizeHex(value: string): string | null {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(value)
  if (!m) return null
  const digits = m[1] as string
  if (digits.length === 3) {
    const [r, g, b] = digits
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  return `#${digits.slice(0, 6)}`.toLowerCase()
}

/**
 * Alpha dropped like `normalizeHex` does: this module's contract is 6 digits.
 * Alpha survives on the opentui path the TUI renders from.
 */
function rgbToHex({ r, g, b }: ColorLiteral): string {
  const hex = (n: number) => n.toString(16).padStart(2, "0")
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

/** Follows def and slot refs like `resolveTheme()`; `null` when missing, transparent, circular, or malformed. */
export function resolveThemeSlotHex(theme: ThemeJson, slot: string, mode: "dark" | "light" = "dark"): string | null {
  const defs = theme.defs ?? {}

  function resolve(c: ColorValue, chain: string[]): string | null {
    if (typeof c === "string") {
      if (c === "transparent" || c === "none") return null
      if (c.startsWith("#")) return normalizeHex(c)
      const rgb = parseRgbLiteral(c)
      if (rgb) return rgbToHex(rgb)
      if (chain.includes(c)) return null
      const next = (defs[c] ?? theme.theme[c]) as ColorValue | undefined
      if (next === undefined) return null
      return resolve(next, [...chain, c])
    }
    if (!c || typeof c !== "object") return null
    const variant = c[mode]
    return typeof variant === "string" ? resolve(variant, chain) : null
  }

  const value = theme.theme[slot] as ColorValue | undefined
  if (value === undefined) return null
  return resolve(value, [slot])
}
