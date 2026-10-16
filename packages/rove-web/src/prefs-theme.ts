/**
 * Theme data → page colours. The bridge resolves each TUI theme to `#rrggbb` per slot
 * (`prefs.get`); this maps those slots onto the quill tokens `styles.css` paints with, and onto
 * the xterm palette. Slots a theme lacks were already filled by the bridge, as `resolveTheme` does.
 */

import type { Prefs, ThemeEntry } from "./prefs.ts"
import { createStore } from "./store.ts"

export type Mode = "dark" | "light"
type Palette = Readonly<Record<string, string>>

/** `auto` follows the browser's colour scheme, as the TUI follows the terminal's. */
export function resolveMode(preference: Prefs["themeMode"], systemDark: boolean): Mode {
  return preference === "auto" ? (systemDark ? "dark" : "light") : preference
}

/** The chosen theme's half; a theme that is gone falls back to `claude`, like the TUI. */
export function paletteFor(themes: readonly ThemeEntry[], name: string, mode: Mode): Palette | null {
  const entry = themes.find((t) => t.name === name) ?? themes.find((t) => t.name === "claude")
  return entry ? entry[mode] : null
}

/** Custom properties for `:root`. Empty before the first reply, so the stylesheet's own dark tokens stand. */
export function cssVars(palette: Palette, prefs: Pick<Prefs, "focusAccent" | "colorblind">): Record<string, string> {
  const cb = prefs.colorblind === "on"
  return {
    "--paper": palette.background,
    "--surface": palette.backgroundPanel,
    "--inset": palette.backgroundElement,
    "--menu": palette.backgroundMenu,
    "--line": palette.border,
    "--line-active": palette.borderActive,
    "--line-subtle": palette.borderSubtle,
    "--ink": palette.text,
    "--muted": palette.textMuted,
    "--subtle": palette.diffLineNumber,
    "--accent": palette.primary,
    "--error": palette.error,
    "--success": palette.success,
    "--warning": palette.warning,
    "--info": palette.info,
    "--focus": palette[prefs.focusAccent] ?? palette.primary,
    "--diff-added": (cb ? palette.diffAddedColorblind : palette.diffAdded) ?? palette.diffAdded,
    "--diff-removed": palette.diffRemoved,
    "--diff-added-bg": (cb ? palette.diffAddedBgColorblind : palette.diffAddedBg) ?? palette.diffAddedBg,
    "--diff-removed-bg": palette.diffRemovedBg,
  } as Record<string, string>
}

/** xterm's colours from the same slots (the TUI's `theme.text`/`background` are the terminal defaults). */
export function xtermTheme(palette: Palette): Record<string, string> {
  return {
    background: palette.background,
    foreground: palette.text,
    cursor: palette.primary,
    cursorAccent: palette.background,
    selectionBackground: palette.backgroundMenu,
    black: palette.background,
    red: palette.error,
    green: palette.success,
    yellow: palette.warning,
    blue: palette.info,
    magenta: palette.syntaxType,
    cyan: palette.secondary,
    white: palette.textMuted,
    brightBlack: palette.diffLineNumber,
    brightRed: palette.error,
    brightGreen: palette.success,
    brightYellow: palette.warning,
    brightBlue: palette.info,
    brightMagenta: palette.syntaxType,
    brightCyan: palette.secondary,
    brightWhite: palette.text,
  } as Record<string, string>
}

/** The xterm colours in use; null until a palette is known (the terminal keeps its built-in dark ones). */
export const terminalTheme = createStore<Record<string, string> | null>(null)
