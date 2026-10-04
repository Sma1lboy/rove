/**
 * The one function that lands a `{ theme, themeMode, transparentBackground,
 * focusAccent }` snapshot on the theme runtime, for every host's boot
 * (`tui-react/lib/host-boot.tsx`) and every live `ui-prefs` daemon push, so
 * hosts can't drift.
 *
 * The target is INJECTED rather than `useTheme()`:
 *   - the theme provider imports @opentui/react, unloadable under vitest, and
 *     these rules must stay unit-testable;
 *   - echo guard: the process that caused a write gets its own push back, so
 *     every setter compares with current and an identical payload is a no-op.
 */

/** Mirror of `FOCUS_ACCENT_SLOTS` in `tui/context/theme-core.ts`, local to keep this module import-free. */
export const UI_PREFS_FOCUS_ACCENT_SLOTS = ["primary", "success", "info"] as const
export type UiPrefsFocusAccentSlot = (typeof UI_PREFS_FOCUS_ACCENT_SLOTS)[number]

/** Unset-pref default (the theme provider's, `tui-react/context/theme.tsx`). */
export const DEFAULT_FOCUS_ACCENT_SLOT: UiPrefsFocusAccentSlot = "primary"

/** Mirror of `THEME_MODE_PREFERENCES` in `tui/context/theme-core.ts`, local for the same reason. */
const UI_PREFS_THEME_MODES = ["dark", "light", "auto"] as const
export type UiPrefsThemeMode = (typeof UI_PREFS_THEME_MODES)[number]
/** `DEFAULT_THEME_MODE` in `tui/context/theme-core.ts`. */
export const DEFAULT_UI_PREFS_THEME_MODE: UiPrefsThemeMode = "dark"

/** A visual-prefs snapshot, as loose as the wire/file can make it. */
export interface UiPrefsSnapshot {
  readonly theme?: unknown
  readonly themeMode?: unknown
  readonly transparentBackground?: unknown
  readonly focusAccent?: unknown
}

/** `useTheme()` plus a user-theme reload hook; host-boot adapts the real context, tests inject a fake. */
export interface UiPrefsTarget {
  selectedTheme(): string
  hasTheme(name: string): boolean
  setTheme(name: string): boolean
  /** Re-scan `~/.rove/themes/`; called once when a pushed name isn't registered here (added after this pane booted). */
  reloadUserThemes(): void
  themeMode(): string
  setThemeMode(mode: UiPrefsThemeMode): void
  transparentBackground(): boolean
  setTransparentBackground(v: boolean): void
  focusAccent(): string
  setFocusAccent(slot: UiPrefsFocusAccentSlot): void
}

/**
 * Field-by-field, changed-only (the echo guard). Absent/malformed fields are
 * skipped, never defaulted, so a partial snapshot can't reset what it didn't carry.
 *   - theme: an unregistered name triggers ONE user-theme reload; still
 *     unknown → keep the current theme, never yank a working pane to the default.
 *   - themeMode / focusAccent: `null` (persisted "unset") → default; unknown
 *     string skipped.
 *   - transparentBackground: only a real boolean that differs.
 */
export function applyUiPrefs(target: UiPrefsTarget, prefs: UiPrefsSnapshot): void {
  if (typeof prefs.theme === "string" && prefs.theme.length > 0 && prefs.theme !== target.selectedTheme()) {
    if (!target.hasTheme(prefs.theme)) target.reloadUserThemes()
    if (target.hasTheme(prefs.theme)) target.setTheme(prefs.theme)
  }

  if (prefs.themeMode === null || typeof prefs.themeMode === "string") {
    const mode = normalizeThemeMode(prefs.themeMode)
    if (mode && mode !== target.themeMode()) target.setThemeMode(mode)
  }

  if (
    typeof prefs.transparentBackground === "boolean" &&
    prefs.transparentBackground !== target.transparentBackground()
  ) {
    target.setTransparentBackground(prefs.transparentBackground)
  }

  if (prefs.focusAccent === null || typeof prefs.focusAccent === "string") {
    const slot = normalizeFocusAccent(prefs.focusAccent)
    if (slot && slot !== target.focusAccent()) target.setFocusAccent(slot)
  }
}

/** `null` → default slot; known slot passes; unknown → `null` (skip, don't guess). */
export function normalizeFocusAccent(value: string | null): UiPrefsFocusAccentSlot | null {
  if (value === null) return DEFAULT_FOCUS_ACCENT_SLOT
  return (UI_PREFS_FOCUS_ACCENT_SLOTS as readonly string[]).includes(value) ? (value as UiPrefsFocusAccentSlot) : null
}

/** Same rule as {@link normalizeFocusAccent}. */
function normalizeThemeMode(value: string | null): UiPrefsThemeMode | null {
  if (value === null) return DEFAULT_UI_PREFS_THEME_MODE
  return (UI_PREFS_THEME_MODES as readonly string[]).includes(value) ? (value as UiPrefsThemeMode) : null
}
