/**
 * Which glyph preset the state marks draw with (`tui/lib/glyphs.ts`):
 * `braille` is safe in every mono font, `starburst` needs the dingbat block,
 * `ascii` is for terminals and fonts with nothing past 7-bit.
 */

export const GLYPH_SET_KEY = "appearance.glyphSet"

export const GLYPH_SET_NAMES = ["braille", "starburst", "ascii"] as const
export type GlyphSetName = (typeof GLYPH_SET_NAMES)[number]

export const DEFAULT_GLYPH_SET: GlyphSetName = "braille"

/** Coerce a persisted value; anything unrecognized → the default. */
export function normalizeGlyphSet(raw: unknown): GlyphSetName {
  return GLYPH_SET_NAMES.includes(raw as GlyphSetName) ? (raw as GlyphSetName) : DEFAULT_GLYPH_SET
}
