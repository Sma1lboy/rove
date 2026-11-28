/**
 * Pure colour maths on 8-bit `[r, g, b, a]` tuples: OKLCH, WCAG contrast and
 * per-task ink. No opentui, so the TUI (`tui/lib/breathe.ts`, `task-color.ts`,
 * `tui/context/contrast-guard.ts`) wraps it in RGBA and the web bridge uses it as is.
 */

export type Rgba = readonly [number, number, number, number]
type Rgb = readonly [number, number, number, ...number[]]

/** OKLCH; `h` in radians. */
export type Oklch = { l: number; c: number; h: number }

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const toGamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)

export function toOklch(color: Rgb): Oklch {
  const [r, g, b] = color.map((v) => toLinear(v / 255)) as [number, number, number]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { l: L, c: Math.hypot(A, B), h: Math.atan2(B, A) }
}

function linearRgb({ l: L, c, h }: Oklch): [number, number, number] {
  const A = c * Math.cos(h)
  const B = c * Math.sin(h)
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

function fromOklch(color: Oklch, alpha: number): Rgba {
  const ch = (v: number) => Math.round(Math.min(1, Math.max(0, toGamma(v))) * 255)
  const [r, g, b] = linearRgb(color)
  return [ch(r), ch(g), ch(b), alpha]
}

/** `accent` with its OKLCH hue turned by `deg`, lightness and chroma scaled. */
export function turnHueInts(accent: Rgba, deg: number, lightness = 1, chroma = 1): Rgba {
  const base = toOklch(accent)
  return fromOklch({ l: base.l * lightness, c: base.c * chroma, h: base.h + (deg * Math.PI) / 180 }, accent[3])
}

const inGamut = (color: Oklch) => linearRgb(color).every((v) => v >= -1e-4 && v <= 1 + 1e-4)

/** An ink at OKLCH `lightness`, hue `deg`; chroma shrinks until it fits sRGB, so the hue survives. */
export function inkAtHueInts(deg: number, lightness: number, chroma: number, alpha = 255): Rgba {
  const h = (deg * Math.PI) / 180
  let c = chroma
  while (c > 0 && !inGamut({ l: lightness, c, h })) c -= 0.005
  return fromOklch({ l: lightness, c: Math.max(0, c), h }, alpha)
}

const cuspCache = new Map<number, { l: number; c: number }>()

/** Where hue `deg` peaks in sRGB chroma: yellow near l 0.97, blue near 0.45. Memoized per whole degree. */
export function oklchCusp(deg: number): { l: number; c: number } {
  const key = Math.round(deg) % 360
  const hit = cuspCache.get(key)
  if (hit) return hit
  const h = (key * Math.PI) / 180
  let best = { l: 1, c: 0 }
  for (let l = 0.2; l <= 1; l += 0.01) {
    let lo = 0
    let hi = 0.4
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2
      if (inGamut({ l, c: mid, h })) lo = mid
      else hi = mid
    }
    if (lo > best.c) best = { l, c: lo }
  }
  cuspCache.set(key, best)
  return best
}

function srgbChannelToLinear(c: number): number {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance (0–1) of an 8-bit RGB triplet. */
export function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * srgbChannelToLinear(r) + 0.7152 * srgbChannelToLinear(g) + 0.0722 * srgbChannelToLinear(b)
}

/** WCAG contrast ratio between two 8-bit RGB triplets (≥ 1). */
export function contrastRatioTriplet(fg: Rgb, bg: Rgb): number {
  const l1 = relativeLuminance(fg)
  const l2 = relativeLuminance(bg)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60
  else if (max === gn) h = ((bn - rn) / d + 2) * 60
  else h = ((rn - gn) / d + 4) * 60
  return [h, s, l]
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  if (s === 0) {
    const v = Math.round(l * 255)
    return [v, v, v]
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t: number): number => {
    let tn = t
    if (tn < 0) tn += 1
    if (tn > 1) tn -= 1
    const c = tn < 1 / 6 ? p + (q - p) * 6 * tn : tn < 1 / 2 ? q : tn < 2 / 3 ? p + (q - p) * (2 / 3 - tn) * 6 : p
    return Math.round(c * 255)
  }
  return [channel(h / 360 + 1 / 3), channel(h / 360), channel(h / 360 - 1 / 3)]
}

const MID_HOST_LUMINANCE = 0.5

/**
 * `fg` moved to at least `minRatio` against `bg` (the same tuple if it already
 * clears): HSL lightness moves away from the host, hue and saturation kept.
 */
export function ensureContrastInts(fg: Rgba, bg: Rgba, minRatio: number): Rgba {
  const fgTriplet: Rgb = [fg[0], fg[1], fg[2]]
  const bgTriplet: Rgb = [bg[0], bg[1], bg[2]]
  if (contrastRatioTriplet(fgTriplet, bgTriplet) >= minRatio) return fg

  const [h, s, l] = rgbToHsl(fgTriplet)
  // A LIGHT host (luminance > 0.5) gets darker text, anything else lighter: darkening on a
  // mid-tone host would sink the token below the still-opaque dark surfaces.
  const lighten = relativeLuminance(bgTriplet) <= MID_HOST_LUMINANCE

  const at = (lightness: number): number => contrastRatioTriplet(hslToRgb(h, s, lightness), bgTriplet)
  // Binary search for the SMALLEST passing move.
  let lo = lighten ? l : 0
  let hi = lighten ? 1 : l
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2
    if (at(mid) >= minRatio) {
      if (lighten) hi = mid
      else lo = mid
    } else {
      if (lighten) lo = mid
      else hi = mid
    }
  }
  const [r, g, b] = hslToRgb(h, s, lighten ? hi : lo)
  return [r, g, b, fg[3]]
}

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

/** OKLCH hue in degrees, or undefined for greys. */
export function hueOfInts(color: Rgb): number | undefined {
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

export type TaskColorTheme = { accent: Rgba; background: Rgba; success: Rgba; warning: Rgba; error: Rgba }

/** The task's ink: only the id picks a hue; lightness and chroma come from the accent. */
export function taskColorInts(taskId: string, theme: TaskColorTheme): Rgba {
  const { accent, background } = theme
  const light = relativeLuminance(background) > 0.5
  const semantic = [theme.success, theme.warning, theme.error]
    .map(hueOfInts)
    .filter((h): h is number => h !== undefined)
  const hue = taskHue(taskId, light ? LIGHT_HUES : DARK_HUES, semantic)
  // The accent's place relative to its own hue's cusp, re-applied at the task
  // hue's cusp: absolute lightness can't transfer (orange at 0.66 is vivid,
  // amber at 0.66 is mud).
  const target = oklchCusp(hue)
  const accentHue = hueOfInts(accent)
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
  return ensureContrastInts(inkAtHueInts(hue, lightness, chroma, accent[3]), background, MIN_CONTRAST)
}
