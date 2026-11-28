/**
 * Color-section validation for appearance-pack manifests, reusing Rove's theme
 * color literals (`isHex`, `parseRgbLiteral`) and `{ dark, light }` pairs.
 */

import { isObject } from "@sma1lboy/rove-core/lib/is-object.ts"
import { isRgbLiteral, parseRgbLiteral } from "@sma1lboy/rove-core/theme/color-literal.ts"
import { isHex } from "@sma1lboy/rove-core/theme/schema.ts"
import type { ColorValue } from "@sma1lboy/rove-core/theme/theme-data.ts"
import {
  APPEARANCE_COLOR_TOKENS,
  type AppearanceColorToken,
  type AppearanceColors,
  type AppearanceValidationIssue,
} from "./manifest-types.ts"

const COLOR_SECTION_KEYS = new Set(["defs", "tokens", "engineColors"])
const COLOR_TOKEN_SET = new Set<string>(APPEARANCE_COLOR_TOKENS)
const VARIANT_KEYS = new Set(["dark", "light"])
const ENGINE_KEY_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i

export function typeLabel(value: unknown): string {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  return typeof value
}

export function rejectUnknownKeys(
  obj: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  prefix: string,
  issues: AppearanceValidationIssue[],
): void {
  const valid = [...allowed].join(", ")
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      issues.push({
        path: prefix ? `${prefix}.${key}` : key,
        message: `unknown key "${key}" (allowed: ${valid})`,
      })
    }
  }
}

function validateColorAtom(
  raw: unknown,
  path: string,
  defs: Readonly<Record<string, string>>,
  issues: AppearanceValidationIssue[],
): string | undefined {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    issues.push({ path, message: `must be a hex color, rgb()/rgba() literal, or defs ref (got ${typeLabel(raw)})` })
    return undefined
  }
  const value = raw.trim()
  if (isHex(value)) return value
  if (isRgbLiteral(value)) {
    if (parseRgbLiteral(value)) return value
    issues.push({
      path,
      message: `"${value}" is not a valid rgb()/rgba() literal (channels 0-255, alpha 0-1, comma-separated)`,
    })
    return undefined
  }
  if (Object.hasOwn(defs, value)) return value
  const defNames = Object.keys(defs)
  const hint = defNames.length > 0 ? `; defined defs: ${defNames.join(", ")}` : "; no defs declared"
  issues.push({ path, message: `"${value}" is not a valid hex/rgb() color or known defs key${hint}` })
  return undefined
}

function validateColorValue(
  raw: unknown,
  path: string,
  defs: Readonly<Record<string, string>>,
  issues: AppearanceValidationIssue[],
): ColorValue | undefined {
  if (typeof raw === "string") return validateColorAtom(raw, path, defs, issues) as ColorValue | undefined
  if (!isObject(raw)) {
    issues.push({ path, message: `must be a color string or { dark, light } object (got ${typeLabel(raw)})` })
    return undefined
  }
  rejectUnknownKeys(raw, VARIANT_KEYS, path, issues)
  const dark = validateColorAtom(raw.dark, `${path}.dark`, defs, issues)
  const light = validateColorAtom(raw.light, `${path}.light`, defs, issues)
  if (!dark || !light) return undefined
  return { dark, light }
}

export function validateAppearanceColors(
  raw: unknown,
  issues: AppearanceValidationIssue[],
): AppearanceColors | undefined {
  if (raw === undefined) return undefined
  if (!isObject(raw)) {
    issues.push({ path: "colors", message: `must be an object (got ${typeLabel(raw)})` })
    return undefined
  }
  rejectUnknownKeys(raw, COLOR_SECTION_KEYS, "colors", issues)

  const defs: Record<string, string> = {}
  if (raw.defs !== undefined) {
    if (!isObject(raw.defs)) {
      issues.push({ path: "colors.defs", message: `must be an object map (got ${typeLabel(raw.defs)})` })
    } else {
      for (const [key, value] of Object.entries(raw.defs)) {
        if (typeof value !== "string" || value.trim().length === 0) {
          issues.push({
            path: `colors.defs.${key}`,
            message: `must be a non-empty color string (got ${typeLabel(value)})`,
          })
        } else {
          defs[key] = value.trim()
        }
      }
      for (const key of Object.keys(defs)) {
        const seen = new Set<string>([key])
        let cur = defs[key]
        while (cur && !isHex(cur) && !isRgbLiteral(cur)) {
          if (!Object.hasOwn(defs, cur)) {
            issues.push({
              path: `colors.defs.${key}`,
              message: `"${cur}" is not a valid hex/rgb() color or known defs key`,
            })
            break
          }
          if (seen.has(cur)) {
            issues.push({ path: `colors.defs.${key}`, message: `cyclic defs reference through "${cur}"` })
            break
          }
          seen.add(cur)
          cur = defs[cur]
        }
        if (cur && isRgbLiteral(cur) && !parseRgbLiteral(cur)) {
          issues.push({
            path: `colors.defs.${key}`,
            message: `"${cur}" is not a valid rgb()/rgba() literal (channels 0-255, alpha 0-1, comma-separated)`,
          })
        }
      }
    }
  }

  let tokens: Partial<Record<AppearanceColorToken, ColorValue>> | undefined
  if (raw.tokens !== undefined) {
    if (!isObject(raw.tokens)) {
      issues.push({ path: "colors.tokens", message: `must be an object map (got ${typeLabel(raw.tokens)})` })
    } else {
      tokens = {}
      for (const [token, value] of Object.entries(raw.tokens)) {
        if (!COLOR_TOKEN_SET.has(token)) {
          issues.push({
            path: `colors.tokens.${token}`,
            message: `unknown color token "${token}" (valid tokens: ${APPEARANCE_COLOR_TOKENS.join(", ")})`,
          })
          continue
        }
        const checked = validateColorValue(value, `colors.tokens.${token}`, defs, issues)
        if (checked !== undefined) tokens[token as AppearanceColorToken] = checked
      }
    }
  }

  let engineColors: Record<string, ColorValue> | undefined
  if (raw.engineColors !== undefined) {
    if (!isObject(raw.engineColors)) {
      issues.push({
        path: "colors.engineColors",
        message: `must be an object map (got ${typeLabel(raw.engineColors)})`,
      })
    } else {
      engineColors = {}
      for (const [engine, value] of Object.entries(raw.engineColors)) {
        if (!ENGINE_KEY_RE.test(engine)) {
          issues.push({
            path: `colors.engineColors.${engine}`,
            message: `invalid engine key "${engine}" (use letters, digits, dot, underscore, hyphen)`,
          })
          continue
        }
        const checked = validateColorValue(value, `colors.engineColors.${engine}`, defs, issues)
        if (checked !== undefined) engineColors[engine] = checked
      }
    }
  }

  return {
    ...(Object.keys(defs).length > 0 ? { defs } : {}),
    ...(tokens ? { tokens } : {}),
    ...(engineColors ? { engineColors } : {}),
  }
}
