/**
 * Transparent mode puts foreground tokens straight on the host terminal's
 * background, which the palette author never saw: claude's muted `#A9A39A`
 * is ~2.5:1 on a light host, and even `#EAE7DF` text drops below readable.
 * The host bg is only known at runtime (`renderer.getPalette()`), so offending
 * tokens are lifted to a floor by moving lightness AWAY from it, keeping hue
 * (muted stays muted relative to primary). Pure; `theme-core.ts` applies it.
 */

import { RGBA } from "@opentui/core"

/** WCAG AA normal-text floor: `textMuted` carries real content, so 4.5:1, not the 3:1 large-text concession. */
export const HOST_TEXT_MIN_CONTRAST = 4.5

type Rgb = readonly [number, number, number]

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

/** WCAG contrast ratio between two RGBA colors (alpha ignored). */
export function contrastRatio(fg: RGBA, bg: RGBA): number {
  const [fr, fgG, fb] = fg.toInts()
  const [br, bgG, bb] = bg.toInts()
  return contrastRatioTriplet([fr, fgG, fb], [br, bgG, bb])
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
 * `fg` moved to at least `minRatio` against `bg` (untouched if it already
 * clears): HSL lightness moves away from the host, hue and saturation kept,
 * so dark-host terminals typically see zero shift.
 */
export function ensureContrast(fg: RGBA, bg: RGBA, minRatio: number = HOST_TEXT_MIN_CONTRAST): RGBA {
  const fgInts = fg.toInts()
  const bgInts = bg.toInts()
  const fgTriplet: Rgb = [fgInts[0], fgInts[1], fgInts[2]]
  const bgTriplet: Rgb = [bgInts[0], bgInts[1], bgInts[2]]
  if (contrastRatioTriplet(fgTriplet, bgTriplet) >= minRatio) return fg

  const [h, s, l] = rgbToHsl(fgTriplet)
  // A LIGHT host (luminance > 0.5) gets darker text, anything else lighter.
  // The luminance gate matters for mid-tone wallpapers: darkening would pass
  // the host floor but sink the token below the still-OPAQUE dark surfaces
  // (`backgroundDialog`, `backgroundElement`); lightening keeps those readable
  // at the cost of a below-floor muted on a host nobody ships as a default.
  const lighten = relativeLuminance(bgTriplet) <= MID_HOST_LUMINANCE

  const at = (lightness: number): number => contrastRatioTriplet(hslToRgb(h, s, lightness), bgTriplet)
  // Binary search for the SMALLEST passing move: first pass in [l, 1] when
  // lightening, last pass in [0, l] when darkening.
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
  return RGBA.fromInts(r, g, b, fgInts[3])
}
