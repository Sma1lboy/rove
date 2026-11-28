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

/** Optional monospace font family declared by the chosen theme (e.g. imported from a local terminal). */
export function fontFamilyFor(themes: readonly ThemeEntry[], name: string): string | null {
  const entry = themes.find((t) => t.name === name) ?? themes.find((t) => t.name === "claude")
  return entry?.fontFamily ?? null
}

function quoteCssFont(family: string): string {
  return `"${family.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

/** Page `--mono` stack with a theme's font first while keeping Rove Nerd Symbols for icon glyphs. */
export function monoFontStack(family: string): string {
  return `${quoteCssFont(family)}, "Rove Nerd Symbols", "JetBrains Mono", "IBM Plex Mono", "SF Mono", Menlo, Consolas, ui-monospace, monospace`
}

/** xterm.js font stack with a theme's font first while keeping Rove Nerd Symbols for prompt glyphs. */
export function terminalFontStack(family: string): string {
  return `${quoteCssFont(family)}, "Rove Nerd Symbols", "JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace`
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

const toLinear = (c: number) => {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
const toByte = (l: number) => {
  const s = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.max(l, 0) ** (1 / 2.4) - 0.055
  return Math.round(Math.min(1, Math.max(0, s)) * 255)
}

/** OKLab's lightness of `hex` moved by `dl`, hue and chroma kept (Ottosson's sRGB ↔ OKLab matrices). */
function shiftLightness(hex: string, dl: number): string {
  const [r = 0, g = 0, b = 0] = channelsOf(hex).map(toLinear)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s + dl
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const l3 = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m3 = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s3 = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  return `#${[
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ]
    .map((c) => toByte(c).toString(16).padStart(2, "0"))
    .join("")}`
}

/** The docked rail: the page a hair darker, as Claude Desktop's sidebar, so rail and page read as one surface. */
const sidebarOf = (paper: string): string => shiftLightness(paper, luminance(paper) < 0.18 ? -0.01 : -0.008)

/** Custom properties for `:root`. Empty before the first reply, so the stylesheet's own dark tokens stand. */
export function cssVars(palette: Palette, prefs: Pick<Prefs, "focusAccent" | "colorblind">): Record<string, string> {
  const cb = prefs.colorblind === "on"
  const quiet = quietInks(palette)
  return {
    "--paper": palette.background,
    "--sidebar": sidebarOf(palette.background),
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

/** xterm's colours from the same slots; prefers explicit cursor and ANSI 0–15 slots when the theme defines them. */
export function xtermTheme(palette: Palette): Record<string, string> {
  return {
    background: palette.background,
    foreground: palette.text,
    cursor: palette.cursor ?? palette.primary,
    cursorAccent: palette.background,
    selectionBackground: palette.backgroundMenu,
    black: palette.terminalBlack ?? palette.background,
    red: palette.terminalRed ?? palette.error,
    green: palette.terminalGreen ?? palette.success,
    yellow: palette.terminalYellow ?? palette.warning,
    blue: palette.terminalBlue ?? palette.info,
    magenta: palette.terminalMagenta ?? palette.syntaxType,
    cyan: palette.terminalCyan ?? palette.secondary,
    white: palette.terminalWhite ?? palette.textMuted,
    brightBlack: palette.terminalBrightBlack ?? palette.diffLineNumber,
    brightRed: palette.terminalBrightRed ?? palette.error,
    brightGreen: palette.terminalBrightGreen ?? palette.success,
    brightYellow: palette.terminalBrightYellow ?? palette.warning,
    brightBlue: palette.terminalBrightBlue ?? palette.info,
    brightMagenta: palette.terminalBrightMagenta ?? palette.syntaxType,
    brightCyan: palette.terminalBrightCyan ?? palette.secondary,
    brightWhite: palette.terminalBrightWhite ?? palette.text,
  } as Record<string, string>
}

/** The xterm colours in use; null until a palette is known (the terminal keeps its built-in dark ones). */
export const terminalTheme = createStore<Record<string, string> | null>(null)

/** The xterm font stack from the active theme, or null to use the default stack in `term-look.ts`. */
export const terminalFontFamily = createStore<string | null>(null)

/** A theme's two halves, installed or not (a rove.run or local terminal theme previews before it is installed). */
export type PreviewTheme = Pick<ThemeEntry, "name" | "dark" | "light" | "fontFamily">

/** The theme a gallery card is showing while the pointer or focus is on it; `null` paints the saved one. */
export const themePreview = createStore<PreviewTheme | null>(null)
