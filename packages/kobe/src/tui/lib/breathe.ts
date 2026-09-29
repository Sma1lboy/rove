/**
 * Breathing for running glyphs: one raised-cosine cycle drives both the
 * spinner's speed and its ink, so a working row inhales (fast, full accent)
 * and exhales (slow, faded) instead of ticking at a flat rate. Timing after
 * oh-my-pi's thinking glyph (MIT, © Mario Zechner, Can Bölük): dwell swings
 * ~70ms→400ms per frame. Pure, driven by the shared spinner tick.
 */

import { RGBA } from "@opentui/core"

/** One breath in shared-store ticks (80ms each): 2.4s. */
export const BREATH_TICKS = 30

// Frames advanced per tick swing SPEED_MIN → SPEED_MIN + SPEED_SWING. Mean
// 2/3 makes one breath exactly 20 frames, so a 10-frame set loops seamlessly
// and SPINNER_TICK_CYCLE (a multiple of BREATH_TICKS) wraps without a jump.
const SPEED_MIN = 0.2
const SPEED_SWING = 14 / 15

/** Faded end of the exhale: share of the accent left over the muted ink. */
const INK_FLOOR = 0.3

/** 0 at the bottom of a breath, 1 at its peak. */
export function breathLevel(tick: number): number {
  return 0.5 - 0.5 * Math.cos((2 * Math.PI * tick) / BREATH_TICKS)
}

/** Frames travelled by `tick`: the integral of the breathing speed. */
function breathPhase(tick: number): number {
  const wave = tick / 2 - (BREATH_TICKS / (4 * Math.PI)) * Math.sin((2 * Math.PI * tick) / BREATH_TICKS)
  return SPEED_MIN * tick + SPEED_SWING * wave
}

export function breathGlyph(frames: readonly string[], tick: number): string {
  const index = Math.floor(breathPhase(tick) + 1e-9) % frames.length
  return frames[index] ?? frames[0] ?? ""
}

/** `share` of `accent` over `muted`; palette/default inks pass through unmixed. */
export function mixInk(accent: RGBA, muted: RGBA, share: number): RGBA {
  if (accent.intent !== "rgb" || muted.intent !== "rgb") return accent
  const [ar, ag, ab, aa] = accent.toInts()
  const [mr, mg, mb] = muted.toInts()
  const mix = (a: number, m: number) => Math.round(m + (a - m) * share)
  return RGBA.fromInts(mix(ar, mr), mix(ag, mg), mix(ab, mb), aa)
}

/** `accent` faded toward `muted` by the breath. */
export function breathColor(accent: RGBA, muted: RGBA, tick: number): RGBA {
  return mixInk(accent, muted, INK_FLOOR + (1 - INK_FLOOR) * breathLevel(tick))
}

type Oklch = { l: number; c: number; h: number }

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const toGamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)

function toOklch(color: RGBA): Oklch {
  const [r, g, b] = color.toInts().map((v) => toLinear(v / 255))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { l: L, c: Math.hypot(A, B), h: Math.atan2(B, A) }
}

function fromOklch({ l: L, c, h }: Oklch, alpha: number): RGBA {
  const A = c * Math.cos(h)
  const B = c * Math.sin(h)
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  const ch = (v: number) => Math.round(Math.min(1, Math.max(0, toGamma(v))) * 255)
  return RGBA.fromInts(
    ch(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    ch(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    ch(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    alpha,
  )
}

/** `accent` with its OKLCH hue turned by `deg`, lightness and chroma scaled. */
export function turnHue(accent: RGBA, deg: number, lightness = 1, chroma = 1): RGBA {
  if (accent.intent !== "rgb") return accent
  const base = toOklch(accent)
  const turned = { l: base.l * lightness, c: base.c * chroma, h: base.h + (deg * Math.PI) / 180 }
  return fromOklch(turned, accent.toInts()[3])
}
