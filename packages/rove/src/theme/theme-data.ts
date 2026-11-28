/**
 * Opentui-free theme data: the JSON shape, the bundled palettes, and the mode
 * and focus-accent choices. Headless code (`rove api`, the bridge) reads these;
 * resolving to drawable colors is `tui/context/theme-core.ts`.
 */

import { BUNDLED_THEME_JSONS } from "./bundled"

type HexColor = `#${string}`
type RefName = string
type Variant = { dark: HexColor | RefName; light: HexColor | RefName }
export type ColorValue = HexColor | RefName | Variant

export type ThemeJson = {
  $schema?: string
  defs?: Record<string, HexColor | RefName>
  theme: Record<string, ColorValue>
}

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
