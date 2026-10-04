/**
 * Hand-rolled `ThemeJson` validator for bundled (`src/tui/context/theme/*.json`)
 * and user (`~/.rove/themes/*.json`) themes; the shape is small enough not to
 * justify a validator dependency.
 *
 * Validated: top level is an object; `theme` is a required record; optional
 * `defs` values are strings; each theme value is a string (hex or def-ref) or
 * a `{ dark, light }` object of strings.
 *
 * Deliberately NOT enforced:
 *   - Required slots: `resolveTheme` (theme-core.ts) falls back, so a sparse
 *     user theme is a feature.
 *   - Hex format: a non-`#` string is a def-ref, EXCEPT an `rgb(…)`/`rgba(…)`
 *     that failed to parse (rejected by name, see `badRgbLiteral`).
 *     Unresolvable refs render black; requiring predeclared names would be
 *     more rigid than the runtime needs.
 *   - `$schema` content: editor autocomplete only.
 */

import type { ThemeJson } from "../theme-core"
import { isRgbLiteral, parseRgbLiteral } from "./color-literal"

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

/**
 * A value that LOOKS like `rgb(…)` but doesn't parse is a typo, not a def-name:
 * name it rather than let the slot silently render black.
 */
function badRgbLiteral(value: string): string | null {
  if (!isRgbLiteral(value) || parseRgbLiteral(value)) return null
  return `\`${value}\` is not a valid rgb()/rgba() literal (channels 0-255, alpha 0-1, comma-separated)`
}

export type ValidateResult = { ok: true; theme: ThemeJson } | { ok: false; reason: string }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

export function isHex(s: string): boolean {
  return HEX_RE.test(s)
}

/** The one-line `reason` feeds the disk loader's `console.warn` and `kobe theme add`'s error. */
export function validateTheme(value: unknown): ValidateResult {
  if (!isPlainObject(value)) {
    return { ok: false, reason: "theme must be a JSON object at the top level" }
  }
  const obj = value as Record<string, unknown>

  if (!("theme" in obj)) {
    return { ok: false, reason: "missing required key `theme`" }
  }
  const theme = obj.theme
  if (!isPlainObject(theme)) {
    return { ok: false, reason: "`theme` must be an object map" }
  }

  if ("defs" in obj && obj.defs !== undefined) {
    if (!isPlainObject(obj.defs)) {
      return { ok: false, reason: "`defs` must be an object map" }
    }
    for (const [k, v] of Object.entries(obj.defs)) {
      if (typeof v !== "string") {
        return { ok: false, reason: `defs.${k} must be a string (hex like \"#abc\" or a ref name)` }
      }
      const bad = badRgbLiteral(v)
      if (bad) return { ok: false, reason: `defs.${k}: ${bad}` }
    }
  }

  for (const [slot, raw] of Object.entries(theme)) {
    if (typeof raw === "string") {
      const bad = badRgbLiteral(raw)
      if (bad) return { ok: false, reason: `theme.${slot}: ${bad}` }
      continue
    }
    if (!isPlainObject(raw)) {
      return {
        ok: false,
        reason: `theme.${slot} must be a string or a { dark, light } object (got ${raw === null ? "null" : Array.isArray(raw) ? "array" : typeof raw})`,
      }
    }
    const variant = raw as Record<string, unknown>
    if (typeof variant.dark !== "string") {
      return { ok: false, reason: `theme.${slot}.dark must be a string` }
    }
    if (typeof variant.light !== "string") {
      return { ok: false, reason: `theme.${slot}.light must be a string` }
    }
    for (const mode of ["dark", "light"] as const) {
      const bad = badRgbLiteral(variant[mode] as string)
      if (bad) return { ok: false, reason: `theme.${slot}.${mode}: ${bad}` }
    }
    // Extra keys are accepted so future optional variants (e.g. `highContrast`)
    // don't break older binaries.
  }

  if ("$schema" in obj && obj.$schema !== undefined && typeof obj.$schema !== "string") {
    return { ok: false, reason: "`$schema` must be a string when present" }
  }

  return { ok: true, theme: obj as unknown as ThemeJson }
}
