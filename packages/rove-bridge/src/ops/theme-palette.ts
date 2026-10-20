/**
 * Theme data for pages that cannot load the TUI's renderer: a theme's palette as `#rrggbb`
 * (the slots a page paints with), the colorblind diff inks and per-task colours. The colour
 * maths is the TUI's own (`diffInks`, `taskColor`), run here so a page never restates it.
 */

import { type Theme, type ThemeJson, diffInks, resolveTheme } from "@sma1lboy/rove/src/tui/context/theme-core.ts"
import { resolveThemeSlotHex } from "@sma1lboy/rove/src/tui/context/theme/hex.ts"
import { taskColor } from "@sma1lboy/rove/src/tui/lib/task-color.ts"

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
}

const hex2 = (n: number): string => n.toString(16).padStart(2, "0")
const rgbHex = (c: { toInts(): number[] }): string => `#${c.toInts().slice(0, 3).map(hex2).join("")}`

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
  // Colorblind pair, from the TUI's `diffInks(theme, true)`: added turned toward blue.
  const cb = diffInks(resolveTheme(theme, mode), true)
  out.diffAddedColorblind = rgbHex(cb.added)
  out.diffAddedBgColorblind = rgbHex(cb.addedBg)
  return out
}

/** `#rrggbb` per task id under one theme and mode (`useTaskColor`'s colour, minus the setting check). */
export function taskColors(theme: ThemeJson, mode: ThemeMode, ids: readonly string[]): Record<string, string> {
  const resolved: Theme = resolveTheme(theme, mode)
  return Object.fromEntries(ids.map((id) => [id, rgbHex(taskColor(id, resolved))]))
}
