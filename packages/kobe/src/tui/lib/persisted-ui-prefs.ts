/**
 * Read the UI prefs (theme, transparency, focus accent, locale) the outer TUI
 * persisted to `state.json`, for subprocess hosts that can't share its runtime.
 * READ-ONLY by contract: the outer app owns `state.json` (writer: the KV store,
 * `tui/context/kv.tsx`); a subprocess write would race it.
 */

import { readFileSync } from "node:fs"
import { kvStatePath } from "../../env.ts"
import {
  DEFAULT_THEME_MODE,
  FOCUS_ACCENT_SLOTS,
  type FocusAccentSlot,
  THEME_MODE_PREFERENCES,
  type ThemeModePreference,
  hasBundledTheme,
} from "../context/theme-core"
import { DEFAULT_LOCALE, type LocaleId, isLocaleId } from "../i18n/catalog"

/** state.json key holding the persisted UI language. */
export const LOCALE_KEY = "locale"

/**
 * Transparent except on Windows. Transparent mode alpha-0s the background and
 * panel slots (`applyDisplayOverlay`), so the terminal shows through. Windows
 * Terminal ships acrylic/background images by default, and every cell not
 * repainted this frame shows wallpaper, turning ordinary render skew into
 * visible debris. Only an ABSENT key takes this default.
 */
export function defaultTransparentBackground(platform: NodeJS.Platform = process.platform): boolean {
  return platform !== "win32"
}

export interface PersistedUiPrefs {
  /** Validated against the registry; stale names fall back. */
  readonly theme: string
  readonly themeMode: ThemeModePreference
  readonly transparent: boolean
  readonly focusAccent: FocusAccentSlot | null
  readonly locale: LocaleId
}

/**
 * Never throws: missing/malformed `state.json` yields the fallback theme with
 * defaults, so a pane always renders. `isKnownTheme` defaults to the
 * bundled-only check; a host that already loaded user themes (`bootPaneHost`
 * via `loadUserThemes()`) must pass the live registry's check, or every
 * `kobe theme add` theme silently reverts on the next boot.
 */
export function readPersistedUiPrefs(
  fallbackTheme: string,
  isKnownTheme: (name: string) => boolean = hasBundledTheme,
): PersistedUiPrefs {
  try {
    const parsed = JSON.parse(readFileSync(kvStatePath(), "utf8")) as Record<string, unknown>
    const theme =
      typeof parsed.activeTheme === "string" && isKnownTheme(parsed.activeTheme) ? parsed.activeTheme : fallbackTheme
    const themeMode = (THEME_MODE_PREFERENCES as readonly unknown[]).includes(parsed.themeMode)
      ? (parsed.themeMode as ThemeModePreference)
      : DEFAULT_THEME_MODE
    // Only an explicitly stored boolean overrides the per-platform default.
    const transparent =
      typeof parsed.transparentBackground === "boolean" ? parsed.transparentBackground : defaultTransparentBackground()
    const focusAccent =
      typeof parsed.focusAccent === "string" && (FOCUS_ACCENT_SLOTS as readonly string[]).includes(parsed.focusAccent)
        ? (parsed.focusAccent as FocusAccentSlot)
        : null
    const locale = isLocaleId(parsed[LOCALE_KEY]) ? parsed[LOCALE_KEY] : DEFAULT_LOCALE
    return { theme, themeMode, transparent, focusAccent, locale }
  } catch {
    return {
      theme: fallbackTheme,
      themeMode: DEFAULT_THEME_MODE,
      transparent: defaultTransparentBackground(),
      focusAccent: null,
      locale: DEFAULT_LOCALE,
    }
  }
}
