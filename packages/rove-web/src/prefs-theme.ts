/**
 * Theme data → page colours. The bridge resolves each TUI theme to `#rrggbb` per slot
 * (`prefs.get`); this maps those slots onto the quill tokens `tailwind.css` paints with, and onto
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

const channelsOf = (hex: string): number[] => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = channelsOf(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string): number {
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** WCAG AA for small text. */
const MIN_TEXT_CONTRAST = 4.5

/** `--muted` reads at least this much stronger than `--subtle` on every surface, so the two stay in order. */
const MUTED_OVER_SUBTLE = 1.1

/**
 * A text colour kept if it already reaches `floor(surface)` on every surface; otherwise mixed toward white
 * (dark pages) or black (light pages) just far enough, checked on the rounded hex that gets painted. The pole is not
 * the theme's `text`: some themes ink in a hue that is itself under AA on their surfaces.
 */
function legibleOn(
  color: string,
  surfaces: readonly [string, ...string[]],
  floor: (surface: string) => number,
): string {
  const reads = (c: string) => surfaces.every((s) => contrast(c, s) >= floor(s))
  if (reads(color)) return color
  const from = channelsOf(color)
  const pole = luminance(surfaces[0]) < 0.18 ? 255 : 0
  for (let t = 0.02; t < 1; t += 0.02) {
    const mixed = from
      .map((c) =>
        Math.round(c + (pole - c) * t)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
    if (reads(`#${mixed}`)) return `#${mixed}`
  }
  return pole ? "#ffffff" : "#000000"
}

/**
 * `--subtle` is the TUI's line-number grey, tuned for a terminal; on the page it is small text on every surface, so
 * it is raised to AA. That can leave it stronger than the theme's `textMuted`, which would invert the ink > muted >
 * subtle order, so `--muted` is raised to stay a step past it (and to AA itself).
 */
function quietInks(palette: Palette): { muted: string; subtle: string } {
  const surfaces: [string, ...string[]] = [
    palette.background,
    palette.backgroundPanel,
    palette.backgroundElement,
    palette.backgroundMenu,
  ]
  const subtle = legibleOn(palette.diffLineNumber, surfaces, () => MIN_TEXT_CONTRAST)
  const muted = legibleOn(palette.textMuted, surfaces, (s) =>
    Math.max(MIN_TEXT_CONTRAST, contrast(subtle, s) * MUTED_OVER_SUBTLE),
  )
  return { muted, subtle }
}

/** Custom properties for `:root`. Empty before the first reply, so the stylesheet's own dark tokens stand. */
export function cssVars(palette: Palette, prefs: Pick<Prefs, "focusAccent" | "colorblind">): Record<string, string> {
  const cb = prefs.colorblind === "on"
  const quiet = quietInks(palette)
  return {
    "--paper": palette.background,
    "--surface": palette.backgroundPanel,
    "--inset": palette.backgroundElement,
    "--menu": palette.backgroundMenu,
    "--line": palette.border,
    "--line-active": palette.borderActive,
    "--line-subtle": palette.borderSubtle,
    "--ink": palette.text,
    "--muted": quiet.muted,
    "--subtle": quiet.subtle,
    "--accent": palette.primary,
    "--error": palette.error,
    "--success": palette.success,
    "--warning": palette.warning,
    "--info": palette.info,
    "--merged": palette.syntaxType,
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

/** A theme's two halves, installed or not (a rove.run theme previews before it is installed). */
export type PreviewTheme = Pick<ThemeEntry, "name" | "dark" | "light">

/** The theme a gallery card is showing while the pointer or focus is on it; `null` paints the saved one. */
export const themePreview = createStore<PreviewTheme | null>(null)
