/**
 * Framework-free theme core behind `src/tui-react/context/theme.tsx`: JSON
 * types, hex/def-ref/variant resolution, and the display overlay, shared with
 * off-render consumers (`tui/lib/persisted-ui-prefs.ts`, tests) so they can't drift.
 */

import { RGBA } from "@opentui/core"

import { ensureContrast } from "./contrast-guard"
import { BUNDLED_THEME_JSONS } from "./theme/bundled"
import { parseRgbLiteral } from "./theme/color-literal"

type HexColor = `#${string}`
type RefName = string
type Variant = { dark: HexColor | RefName; light: HexColor | RefName }
type ColorValue = HexColor | RefName | Variant

export type ThemeJson = {
  $schema?: string
  defs?: Record<string, HexColor | RefName>
  theme: Record<string, ColorValue>
}

/** Slot names mirror opencode's so lifted components compile; missing slots fall back to a related one. */
export type Theme = {
  primary: RGBA
  secondary: RGBA
  accent: RGBA
  error: RGBA
  warning: RGBA
  /** Warning ink for chrome that paints directly on the host background. */
  warningOnHost: RGBA
  success: RGBA
  info: RGBA
  text: RGBA
  textMuted: RGBA
  background: RGBA
  backgroundPanel: RGBA
  backgroundElement: RGBA
  backgroundMenu: RGBA
  /** Modal card surface; stays opaque in transparent mode. Falls back to `backgroundPanel`. */
  backgroundDialog: RGBA
  border: RGBA
  borderActive: RGBA
  borderSubtle: RGBA
  diffAdded: RGBA
  diffRemoved: RGBA
  diffContext: RGBA
  diffHunkHeader: RGBA
  diffAddedBg: RGBA
  diffRemovedBg: RGBA
  selectedListItemText: RGBA
  /** Resolved from the user's `focusAccent` slot; focus painters read this, not primary/success/info. */
  focusAccent: RGBA
  // arbitrary string access falls through to text
  [key: string]: RGBA
}

/** Payloads live in `./theme/bundled`; re-exported at this path for existing consumers. */
export const BUNDLED_THEMES: Record<string, ThemeJson> = BUNDLED_THEME_JSONS

/** Brand default for new installs and every bundled-palette fallback. */
export const DEFAULT_THEME = "claude"

/**
 * Bundled-only check for off-render callers (`readPersistedUiPrefs` in a pane
 * subprocess) validating a persisted name. The live provider has its own
 * `hasTheme` over bundled + user themes.
 */
export function hasBundledTheme(name: string): boolean {
  return Boolean(BUNDLED_THEMES[name])
}

/** Which half of a `{ dark, light }` theme entry is drawn. */
export type ThemeMode = "dark" | "light"

/**
 * `auto` follows the host terminal: opentui reads its background over OSC 11
 * and re-reads on an appearance-change report (`?2031`). Persisted as
 * `themeMode`; unset is `dark`.
 */
export type ThemeModePreference = ThemeMode | "auto"
export const THEME_MODE_PREFERENCES: ReadonlyArray<ThemeModePreference> = ["dark", "light", "auto"]
export const DEFAULT_THEME_MODE: ThemeModePreference = "dark"

/** `auto` with no answer from the terminal yet (or ever) draws dark. */
export function resolveThemeMode(preference: ThemeModePreference, detected: ThemeMode | null): ThemeMode {
  return preference === "auto" ? (detected ?? "dark") : preference
}

/**
 * Slot for the focused-pane indicator. Default `primary` (terracotta under
 * Claude, the brand hue); `success` = green, `info` = cyan/blue. Persisted via KV.
 */
export type FocusAccentSlot = "primary" | "success" | "info"
export const FOCUS_ACCENT_SLOTS: ReadonlyArray<FocusAccentSlot> = ["primary", "success", "info"]

/**
 * Missing slots fall back (foregrounds → `text`, backgrounds → `background`),
 * so an opencode theme lacking later-added slots never throws.
 */
export function resolveTheme(theme: ThemeJson, mode: ThemeMode = "dark"): Theme {
  const defs = theme.defs ?? {}

  function resolve(c: ColorValue, chain: string[] = []): RGBA {
    if (typeof c === "string") {
      if (c === "transparent" || c === "none") return RGBA.fromInts(0, 0, 0, 0)
      if (c.startsWith("#")) return RGBA.fromHex(c)
      const rgb = parseRgbLiteral(c)
      if (rgb) return RGBA.fromInts(rgb.r, rgb.g, rgb.b, rgb.a)
      if (chain.includes(c)) {
        // circular ref: black rather than throw, to keep the TUI alive
        return RGBA.fromInts(0, 0, 0)
      }
      const next = defs[c] ?? (theme.theme[c] as ColorValue | undefined)
      if (next === undefined) return RGBA.fromInts(0, 0, 0)
      return resolve(next, [...chain, c])
    }
    return resolve(c[mode], chain)
  }

  const out: Record<string, RGBA> = {}
  for (const [k, v] of Object.entries(theme.theme)) {
    out[k] = resolve(v as ColorValue)
  }

  const text = out.text ?? RGBA.fromHex("#ffffff")
  const background = out.background ?? RGBA.fromHex("#000000")
  const fallback: Record<string, RGBA> = {
    primary: out.primary ?? text,
    secondary: out.secondary ?? text,
    accent: out.accent ?? out.primary ?? text,
    error: out.error ?? text,
    warning: out.warning ?? text,
    warningOnHost: out.warning ?? text,
    success: out.success ?? text,
    info: out.info ?? text,
    text,
    textMuted: out.textMuted ?? text,
    background,
    backgroundPanel: out.backgroundPanel ?? background,
    backgroundElement: out.backgroundElement ?? background,
    backgroundMenu: out.backgroundMenu ?? out.backgroundElement ?? background,
    backgroundDialog: out.backgroundDialog ?? out.backgroundPanel ?? background,
    border: out.border ?? text,
    borderActive: out.borderActive ?? out.border ?? text,
    borderSubtle: out.borderSubtle ?? out.border ?? text,
    diffAdded: out.diffAdded ?? out.success ?? text,
    diffRemoved: out.diffRemoved ?? out.error ?? text,
    diffContext: out.diffContext ?? out.textMuted ?? text,
    diffHunkHeader: out.diffHunkHeader ?? out.textMuted ?? text,
    diffAddedBg: out.diffAddedBg ?? background,
    diffRemovedBg: out.diffRemovedBg ?? background,
    selectedListItemText: out.selectedListItemText ?? background,
  }

  return { ...fallback, ...out } as Theme
}

/**
 * Display-time overlay:
 *   1. `focusAccent` from the user's slot, else `primary` (user themes may lack it).
 *   2. Transparent: `background` AND `backgroundPanel` go alpha-0 (all panels
 *      read panel). `backgroundElement` stays tinted so inputs stay legible;
 *      `backgroundDialog` stays OPAQUE, since a translucent modal lets pane
 *      content bleed through its text.
 *   3. Transparent + known host background: `text`, `textMuted` and
 *      `warningOnHost` are contrast-guarded against it (`contrast-guard.ts`);
 *      base `warning` stays for opaque surfaces. Unknown host bg → unchanged.
 */
export function applyDisplayOverlay(
  base: Theme,
  focusAccent: FocusAccentSlot,
  transparentBackground: boolean,
  hostBackground?: RGBA,
): Theme {
  const v: Theme = {
    ...base,
    focusAccent: base[focusAccent] ?? base.primary,
    warningOnHost: base.warning,
  }
  if (!transparentBackground) return v
  const [backgroundR, backgroundG, backgroundB] = base.background.toInts()
  const [panelR, panelG, panelB] = base.backgroundPanel.toInts()
  const transparent: Theme = {
    ...v,
    background: RGBA.fromInts(backgroundR, backgroundG, backgroundB, 0),
    backgroundPanel: RGBA.fromInts(panelR, panelG, panelB, 0),
  }
  if (!hostBackground) return transparent
  return {
    ...transparent,
    text: ensureContrast(transparent.text, hostBackground),
    textMuted: ensureContrast(transparent.textMuted, hostBackground),
    warningOnHost: ensureContrast(transparent.warning, hostBackground),
  }
}
