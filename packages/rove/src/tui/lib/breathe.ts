/**
 * Breathing for running glyphs: one raised-cosine cycle drives both the
 * spinner's speed and its ink, so a working row inhales (fast, full accent)
 * and exhales (slow, faded) instead of ticking at a flat rate. Timing after
 * oh-my-pi's thinking glyph (MIT, © Mario Zechner, Can Bölük): dwell swings
 * ~70ms→400ms per frame. Pure, driven by the shared spinner tick.
 */

import { RGBA } from "@opentui/core"
import {
  type Oklch,
  inkAtHueInts,
  oklchCusp,
  toOklch as toOklchInts,
  turnHueInts,
} from "@sma1lboy/rove-core/theme/color-math.ts"

export { oklchCusp }

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

const ints = (c: RGBA) => c.toInts() as [number, number, number, number]
const rgba = ([r, g, b, a]: readonly number[]) => RGBA.fromInts(r as number, g as number, b as number, a)

export const toOklch = (color: RGBA): Oklch => toOklchInts(ints(color))

/** `accent` with its OKLCH hue turned by `deg`, lightness and chroma scaled. */
export function turnHue(accent: RGBA, deg: number, lightness = 1, chroma = 1): RGBA {
  if (accent.intent !== "rgb") return accent
  return rgba(turnHueInts(ints(accent), deg, lightness, chroma))
}

/** An ink at OKLCH `lightness`, hue `deg`; chroma shrinks until it fits sRGB, so the hue survives. */
export const inkAtHue = (deg: number, lightness: number, chroma: number, alpha = 255): RGBA =>
  rgba(inkAtHueInts(deg, lightness, chroma, alpha))
