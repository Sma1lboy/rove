/**
 * Transparent mode puts foreground tokens straight on the host terminal's
 * background, which the palette author never saw: claude's muted `#A9A39A`
 * is ~2.5:1 on a light host, and even `#EAE7DF` text drops below readable.
 * The host bg is only known at runtime (`renderer.getPalette()`), so offending
 * tokens are lifted to a floor by moving lightness AWAY from it, keeping hue
 * (muted stays muted relative to primary). Pure; `theme-core.ts` applies it.
 */

import { RGBA } from "@opentui/core"
import { contrastRatioTriplet, ensureContrastInts, relativeLuminance } from "@sma1lboy/rove-core/theme/color-math.ts"

/** WCAG AA normal-text floor: `textMuted` carries real content, so 4.5:1, not the 3:1 large-text concession. */
export const HOST_TEXT_MIN_CONTRAST = 4.5

export { contrastRatioTriplet, relativeLuminance }

/** WCAG contrast ratio between two RGBA colors (alpha ignored). */
export function contrastRatio(fg: RGBA, bg: RGBA): number {
  const [fr, fgG, fb] = fg.toInts()
  const [br, bgG, bb] = bg.toInts()
  return contrastRatioTriplet([fr, fgG, fb], [br, bgG, bb])
}

/**
 * `fg` moved to at least `minRatio` against `bg` (untouched if it already
 * clears): HSL lightness moves away from the host, hue and saturation kept,
 * so dark-host terminals typically see zero shift.
 */
export function ensureContrast(fg: RGBA, bg: RGBA, minRatio: number = HOST_TEXT_MIN_CONTRAST): RGBA {
  const from = fg.toInts() as [number, number, number, number]
  const to = ensureContrastInts(from, bg.toInts() as [number, number, number, number], minRatio)
  return to === from ? fg : RGBA.fromInts(to[0], to[1], to[2], to[3])
}
