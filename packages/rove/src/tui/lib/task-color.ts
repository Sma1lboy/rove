/**
 * Every task gets its own colour, stable across restarts: the task id picks
 * only a HUE; lightness and chroma come from the theme accent, so each task
 * colour weighs the same as the accent it stands in for. After oh-my-pi's
 * session colour (MIT, © Mario Zechner, Can Bölük).
 */

import type { RGBA } from "@opentui/core"
import { ensureContrast, relativeLuminance } from "../context/contrast-guard"
import type { Theme } from "../context/theme-core"
import { inkAtHue, oklchCusp, toOklch } from "./breathe"

type HueArc = readonly [number, number]

/** Dark themes: the wheel minus hues that only darken into mud (yellow-green ~94–138°) or glare (cyan ~158–200°). */
const DARK_HUES: readonly HueArc[] = [
  [0, 93],
  [139, 157],
  [201, 359],
]
/** Light themes: the cool band, which stays itself when darkened for contrast. */
const LIGHT_HUES: readonly HueArc[] = [[195, 330]]

/**
 * A task hue never sits this close to success/warning/error, so it can't read
 * as a state. At the same weight, 13° off claude's error red is the same red.
 */
export const SEMANTIC_GUARD_DEG = 25
/** 8-bit rounding moves the final hue by a degree or two; pick with slack so the guard still holds. */
const GUARD_SLACK_DEG = 2
/** Below this OKLCH chroma a colour has no meaningful hue. */
const GREY_CHROMA = 0.03
/** A grey accent carries no vividness; sit at this share of each hue's peak chroma instead. */
const GREY_ACCENT_CHROMA_SHARE = 0.7
const MIN_CHROMA = 0.05
const MAX_CHROMA = 0.21
const DARK_MIN_LIGHTNESS = 0.65
const DARK_MAX_LIGHTNESS = 0.88
/** WCAG large-text floor against the theme background. */
const MIN_CONTRAST = 3

export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return Math.min(d, 360 - d)
}

/** OKLCH hue in degrees, or undefined for greys and palette inks. */
export function hueOf(color: RGBA): number | undefined {
  if (color.intent !== "rgb") return undefined
  const { c, h } = toOklch(color)
  if (c < GREY_CHROMA) return undefined
  return ((((h * 180) / Math.PI) % 360) + 360) % 360
}

/** djb2 + murmur3's finalizer: stable across restarts, and ids differing in one character land far apart. */
function hash(text: string): number {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = (((h << 5) + h) ^ text.charCodeAt(i)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

/**
 * The id's hue, drawn uniformly from the arc's whole degrees minus the guard
 * bands (cutting before hashing spreads ids evenly; walking out of a band
 * would pile them on its edges).
 */
function taskHue(taskId: string, arcs: readonly HueArc[], semantic: readonly number[]): number {
  const all = arcs.flatMap(([from, to]) => Array.from({ length: to - from + 1 }, (_, i) => from + i))
  const clear = all.filter((h) => semantic.every((s) => hueDistance(h, s) >= SEMANTIC_GUARD_DEG + GUARD_SLACK_DEG))
  const hues = clear.length > 0 ? clear : all
  return hues[hash(taskId) % hues.length] ?? 0
}

function computeTaskColor(taskId: string, theme: Theme): RGBA {
  const accent = theme.accent
  const [r, g, b] = theme.background.toInts()
  const light = relativeLuminance([r, g, b]) > 0.5
  const semantic = [theme.success, theme.warning, theme.error].map(hueOf).filter((h): h is number => h !== undefined)
  const hue = taskHue(taskId, light ? LIGHT_HUES : DARK_HUES, semantic)
  // The accent's place relative to its own hue's cusp, re-applied at the task
  // hue's cusp: absolute lightness can't transfer (orange at 0.66 is vivid,
  // amber at 0.66 is mud).
  const target = oklchCusp(hue)
  const accentHue = hueOf(accent)
  let lightness = target.l
  let share = GREY_ACCENT_CHROMA_SHARE
  if (accentHue !== undefined) {
    const { l, c } = toOklch(accent)
    const source = oklchCusp(accentHue)
    lightness =
      l <= source.l ? (l / source.l) * target.l : target.l + ((l - source.l) / (1 - source.l)) * (1 - target.l)
    share = c / source.c
  }
  const chroma = Math.min(MAX_CHROMA, Math.max(MIN_CHROMA, share * target.c))
  if (!light) lightness = Math.min(DARK_MAX_LIGHTNESS, Math.max(DARK_MIN_LIGHTNESS, lightness))
  return ensureContrast(inkAtHue(hue, lightness, chroma, accent.toInts()[3]), theme.background, MIN_CONTRAST)
}

const cache = new Map<string, RGBA>()
const CACHE_LIMIT = 256

/** The task's colour under `theme`; a palette/default accent passes through unchanged. */
export function taskColor(taskId: string, theme: Theme): RGBA {
  if (theme.accent.intent !== "rgb") return theme.accent
  const key = [taskId, theme.accent, theme.background, theme.success, theme.warning, theme.error]
    .map((part) => (typeof part === "string" ? part : part.toInts().join()))
    .join("|")
  const hit = cache.get(key)
  if (hit) return hit
  const color = computeTaskColor(taskId, theme)
  if (cache.size >= CACHE_LIMIT) cache.clear()
  cache.set(key, color)
  return color
}
