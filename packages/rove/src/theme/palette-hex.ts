/**
 * `resolveTheme()`'s numbers without opentui: slot colours as 8-bit tuples with its fallbacks
 * (missing def → black, `transparent` → alpha 0, circular → black, malformed hex → magenta),
 * plus the colorblind diff pair and per-task ink on top. `resolveThemeSlotHex` (`./hex`) is the
 * "skip what can't resolve" sibling; this one paints like the TUI does.
 */

import { parseRgbLiteral } from "./color-literal"
import { type Rgba, taskColorInts, turnHueInts } from "./color-math"
import type { ColorValue, ThemeJson, ThemeMode } from "./theme-data"

const BLACK: Rgba = [0, 0, 0, 255]

/** Same parse as opentui's `RGBA.fromHex`. */
function hexInts(value: string): Rgba {
  let hex = value.replace(/^#/, "")
  if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join("")
  if (!/^(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(hex)) return [255, 0, 255, 255]
  const n = (i: number) => Number.parseInt(hex.slice(i, i + 2), 16)
  return [n(0), n(2), n(4), hex.length === 8 ? n(6) : 255]
}

/** The theme's own slots resolved like `resolveTheme()` (before its fallbacks for absent slots). */
function resolveSlots(theme: ThemeJson, mode: ThemeMode): Record<string, Rgba> {
  const defs = theme.defs ?? {}
  function resolve(c: ColorValue, chain: string[] = []): Rgba {
    if (typeof c !== "string") return resolve(c[mode], chain)
    if (c === "transparent" || c === "none") return [0, 0, 0, 0]
    if (c.startsWith("#")) return hexInts(c)
    const rgb = parseRgbLiteral(c)
    if (rgb) return [rgb.r, rgb.g, rgb.b, rgb.a]
    if (chain.includes(c)) return BLACK
    const next = defs[c] ?? (theme.theme[c] as ColorValue | undefined)
    return next === undefined ? BLACK : resolve(next, [...chain, c])
  }
  const out: Record<string, Rgba> = {}
  for (const [k, v] of Object.entries(theme.theme)) out[k] = resolve(v as ColorValue)
  return out
}

export type PaletteInks = {
  diffAddedColorblind: Rgba
  diffAddedBgColorblind: Rgba
  taskTheme: Parameters<typeof taskColorInts>[1]
}

/** The colorblind diff pair (`diffInks(theme, true)`: added turned +60°, chroma ×0.71) and the theme `taskColor` reads. */
export function paletteInks(theme: ThemeJson, mode: ThemeMode): PaletteInks {
  const out = resolveSlots(theme, mode)
  const text = out.text ?? [255, 255, 255, 255]
  const background = out.background ?? BLACK
  const toward = (ink: Rgba) => turnHueInts(ink, 60, 1, 0.71)
  return {
    diffAddedColorblind: toward(out.diffAdded ?? out.success ?? text),
    diffAddedBgColorblind: toward(out.diffAddedBg ?? background),
    taskTheme: {
      accent: out.accent ?? out.primary ?? text,
      background,
      success: out.success ?? text,
      warning: out.warning ?? text,
      error: out.error ?? text,
    },
  }
}

export const rgbToHex = ([r, g, b]: Rgba): string =>
  `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`

/** `#rrggbb` ink for one task id under `inks.taskTheme`. */
export const taskHex = (taskId: string, inks: PaletteInks): string => rgbToHex(taskColorInts(taskId, inks.taskTheme))
