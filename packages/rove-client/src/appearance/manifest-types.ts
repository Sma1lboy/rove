/**
 * Appearance-pack manifest types, token allowlists, and mode-aware color resolvers.
 * Separated from validation (`./manifest.ts`) so callers that only need types or
 * CSS-token resolution stay small and focused.
 */

import { isRgbLiteral } from "@sma1lboy/rove-core/theme/color-literal.ts"
import { isHex } from "@sma1lboy/rove-core/theme/schema.ts"
import type { ColorValue } from "@sma1lboy/rove-core/theme/theme-data.ts"
import type { ModNode } from "@sma1lboy/rove-daemon/plugins/mod-tree"
import type { AppearanceSlotId } from "./slots.ts"

export const APPEARANCE_SCHEMA_VERSION = 1 as const
export const APPEARANCE_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/

/** Semantic color tokens an appearance pack may override (mapped to CSS vars in web). */
export const APPEARANCE_COLOR_TOKENS = [
  "paper",
  "sidebar",
  "surface",
  "inset",
  "menu",
  "line",
  "lineFaint",
  "lineActive",
  "ink",
  "muted",
  "subtle",
  "accent",
  "accentSoft",
  "hover",
  "focus",
  "info",
  "error",
  "success",
  "warning",
  "merged",
  "diffAdded",
  "diffRemoved",
  "diffAddedBg",
  "diffRemovedBg",
] as const

export type AppearanceColorToken = (typeof APPEARANCE_COLOR_TOKENS)[number]

/** Maps manifest camelCase color token names to rove-web's CSS custom properties. */
export const APPEARANCE_COLOR_CSS_VAR: Readonly<Record<AppearanceColorToken, string>> = {
  paper: "--paper",
  sidebar: "--sidebar",
  surface: "--surface",
  inset: "--inset",
  menu: "--menu",
  line: "--line",
  lineFaint: "--line-faint",
  lineActive: "--line-active",
  ink: "--ink",
  muted: "--muted",
  subtle: "--subtle",
  accent: "--accent",
  accentSoft: "--accent-soft",
  hover: "--hover",
  focus: "--focus",
  info: "--info",
  error: "--error",
  success: "--success",
  warning: "--warning",
  merged: "--merged",
  diffAdded: "--diff-added",
  diffRemoved: "--diff-removed",
  diffAddedBg: "--diff-added-bg",
  diffRemovedBg: "--diff-removed-bg",
}

export const APPEARANCE_FRAMES = ["flush", "cards"] as const
export type AppearanceFrame = (typeof APPEARANCE_FRAMES)[number]

export const APPEARANCE_DENSITIES = ["compact", "comfortable", "spacious"] as const
export type AppearanceDensity = (typeof APPEARANCE_DENSITIES)[number]

export const APPEARANCE_BORDER_STYLES = ["hairline", "solid", "none"] as const
export type AppearanceBorderStyle = (typeof APPEARANCE_BORDER_STYLES)[number]

export const APPEARANCE_STATUS_BAR_MODES = ["auto", "always", "hidden"] as const
export type AppearanceStatusBarMode = (typeof APPEARANCE_STATUS_BAR_MODES)[number]

export const APPEARANCE_SLOT_SURFACES = ["paper", "sidebar", "surface", "inset", "accentSoft", "engineTint"] as const
export type AppearanceSlotSurface = (typeof APPEARANCE_SLOT_SURFACES)[number]

export const APPEARANCE_SLOT_VARIANTS = ["default", "card", "compact", "pill", "minimal"] as const
export type AppearanceSlotVariant = (typeof APPEARANCE_SLOT_VARIANTS)[number]

export interface AppearanceColors {
  readonly defs?: Readonly<Record<string, string>>
  readonly tokens?: Readonly<Partial<Record<AppearanceColorToken, ColorValue>>>
  /** Per-engine accent/card color keyed by engine id (or `"default"` fallback). */
  readonly engineColors?: Readonly<Record<string, ColorValue>>
}

export interface AppearanceLayout {
  readonly frame?: AppearanceFrame
  readonly paneGap?: number
  readonly shellPadding?: number
  readonly radius?: number
  readonly radiusSm?: number
  readonly radiusXs?: number
  readonly density?: AppearanceDensity
  readonly railWidth?: number
  readonly borderStyle?: AppearanceBorderStyle
  readonly statusBar?: AppearanceStatusBarMode
}

export interface AppearanceSlotSpec {
  readonly component?: string
  readonly export?: string
  readonly fields?: readonly string[]
  readonly secondaryFields?: readonly string[]
  readonly tree?: ModNode
  readonly hidden?: boolean
  readonly surface?: AppearanceSlotSurface
  readonly variant?: AppearanceSlotVariant
}

export interface AppearanceManifest {
  readonly $schema?: string
  readonly version: typeof APPEARANCE_SCHEMA_VERSION
  readonly name: string
  readonly description?: string
  readonly author?: string
  /** Optional installed/bundled theme name to inherit colors from before `colors.tokens` overrides. */
  readonly theme?: string
  readonly colors?: AppearanceColors
  readonly layout?: AppearanceLayout
  readonly slots?: Readonly<Partial<Record<AppearanceSlotId, AppearanceSlotSpec>>>
}

export interface AppearanceValidationIssue {
  readonly path: string
  readonly message: string
}

export type AppearanceValidateResult =
  | { readonly ok: true; readonly manifest: AppearanceManifest }
  | { readonly ok: false; readonly issues: readonly AppearanceValidationIssue[]; readonly summary: string }

function resolveColorAtom(atom: string, defs: Readonly<Record<string, string>>): string {
  let cur = atom
  const seen = new Set<string>()
  while (!isHex(cur) && !isRgbLiteral(cur) && Object.hasOwn(defs, cur) && !seen.has(cur)) {
    seen.add(cur)
    cur = defs[cur]
  }
  return cur
}

function resolveColorValue(value: ColorValue, mode: "dark" | "light", defs: Readonly<Record<string, string>>): string {
  const atom = typeof value === "string" ? value : value[mode]
  return resolveColorAtom(atom, defs)
}

/** Resolve manifest `colors.tokens` for a mode into CSS custom property name -> color string. */
export function resolveAppearanceCssColors(
  colors: AppearanceColors | undefined,
  mode: "dark" | "light",
): Record<string, string> {
  if (!colors?.tokens) return {}
  const defs = colors.defs ?? {}
  const out: Record<string, string> = {}
  for (const [token, val] of Object.entries(colors.tokens)) {
    if (!val || !Object.hasOwn(APPEARANCE_COLOR_CSS_VAR, token)) continue
    out[APPEARANCE_COLOR_CSS_VAR[token as AppearanceColorToken]] = resolveColorValue(val, mode, defs)
  }
  return out
}

/** Resolve manifest `colors.engineColors` for a mode into engine id -> color string. */
export function resolveAppearanceEngineColors(
  colors: AppearanceColors | undefined,
  mode: "dark" | "light",
): Record<string, string> {
  if (!colors?.engineColors) return {}
  const defs = colors.defs ?? {}
  const out: Record<string, string> = {}
  for (const [engine, val] of Object.entries(colors.engineColors)) {
    out[engine] = resolveColorValue(val, mode, defs)
  }
  return out
}
