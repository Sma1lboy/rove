/** Resolve the terminal colors a headless engine should see from Rove's persisted theme. */

import {
  DEFAULT_TERMINAL_COLORS,
  type TerminalDefaultColors,
  parseTerminalDefaultColors,
} from "@sma1lboy/kobe-daemon/daemon/terminal-colors"
import { BUNDLED_THEMES, DEFAULT_THEME, type ThemeJson } from "../context/theme-core"
import { resolveThemeSlotHex } from "../context/theme/hex"
import { loadUserThemes } from "../context/theme/loader"
import { readPersistedUiPrefs } from "./persisted-ui-prefs"

export function terminalDefaultColorsForTheme(theme: ThemeJson): TerminalDefaultColors {
  return (
    parseTerminalDefaultColors({
      foreground: resolveThemeSlotHex(theme, "text", "dark"),
      background: resolveThemeSlotHex(theme, "background", "dark"),
    }) ?? DEFAULT_TERMINAL_COLORS
  )
}

/** Headless `rove api` launches have no React theme provider to ask. Read the
 * same persisted selection the next TUI will use, including user themes. */
export function readPersistedTerminalDefaultColors(): TerminalDefaultColors {
  const themes: Record<string, ThemeJson> = { ...BUNDLED_THEMES }
  for (const { name, theme } of loadUserThemes()) themes[name] = theme
  const prefs = readPersistedUiPrefs(DEFAULT_THEME, (name) => Boolean(themes[name]))
  const selected = themes[prefs.theme] ?? themes[DEFAULT_THEME]
  return selected ? terminalDefaultColorsForTheme(selected) : DEFAULT_TERMINAL_COLORS
}
