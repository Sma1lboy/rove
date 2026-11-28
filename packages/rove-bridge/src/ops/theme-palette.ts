/**
 * Theme data for pages that cannot load the TUI's renderer: a theme's palette as `#rrggbb`
 * (the slots a page paints with), the colorblind diff inks and per-task colours. The colour
 * maths is shared with the TUI (`src/theme/color-math.ts`), so a page never restates it.
 */

import { resolveThemeSlotHex } from "@sma1lboy/rove-core/theme/hex.ts"
import { paletteInks, rgbToHex, taskHex } from "@sma1lboy/rove-core/theme/palette-hex.ts"
import { TERMINAL_ANSI_SLOTS } from "@sma1lboy/rove-core/theme/terminal-scheme.ts"
import type { ThemeJson } from "@sma1lboy/rove-core/theme/theme-data.ts"

export type ThemeMode = "dark" | "light"

/** The theme slots a page paints with, each with the slot `resolveTheme` falls back to when a theme omits it. */
const SLOTS: Readonly<Record<string, string | null>> = {
  text: null,
  background: null,
  textMuted: "text",
  backgroundPanel: "background",
  backgroundElement: "background",
  backgroundMenu: "backgroundElement",
  border: "text",
  borderActive: "border",
  borderSubtle: "border",
  primary: "text",
  secondary: "text",
  accent: "primary",
  error: "text",
  warning: "text",
  success: "text",
  info: "text",
  diffAdded: "success",
  diffRemoved: "error",
  diffLineNumber: "textMuted",
  syntaxType: "info",
  diffAddedBg: "background",
  diffRemovedBg: "background",
  cursor: "primary",
}

export function palette(theme: ThemeJson, mode: ThemeMode): Record<string, string> {
  const out: Record<string, string> = {}
  const slot = (name: string): string => {
    const known = out[name]
    if (known) return known
    const fallback = SLOTS[name]
    const value =
      resolveThemeSlotHex(theme, name, mode) ??
      (fallback ? slot(fallback) : name === "background" ? "#000000" : "#ffffff")
    out[name] = value
    return value
  }
  for (const name of Object.keys(SLOTS)) slot(name)
  // Pass through optional terminal ANSI 0–15 slots when the theme defines them (e.g. imported terminal schemes).
  for (const ansiSlot of TERMINAL_ANSI_SLOTS) {
    const value = resolveThemeSlotHex(theme, ansiSlot, mode)
    if (value) out[ansiSlot] = value
  }
  // Colorblind pair, from the TUI's `diffInks(theme, true)`: added turned toward blue.
  const cb = paletteInks(theme, mode)
  out.diffAddedColorblind = rgbToHex(cb.diffAddedColorblind)
  out.diffAddedBgColorblind = rgbToHex(cb.diffAddedBgColorblind)
  return out
}

/** `#rrggbb` per task id under one theme and mode (`useTaskColor`'s colour, minus the setting check). */
export function taskColors(theme: ThemeJson, mode: ThemeMode, ids: readonly string[]): Record<string, string> {
  const inks = paletteInks(theme, mode)
  return Object.fromEntries(ids.map((id) => [id, taskHex(id, inks)]))
}
