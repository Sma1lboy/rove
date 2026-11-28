import { GLYPH_SETS, type GlyphSet } from "../../lib/glyphs"
import { DEFAULT_GLYPH_SET, GLYPH_SET_KEY, normalizeGlyphSet } from "../../state/glyph-set"
import { useOptionalKV } from "../context/kv"

/** The glyph preset from Settings; braille without a KV provider. */
export function useGlyphs(): GlyphSet {
  return GLYPH_SETS[normalizeGlyphSet(useOptionalKV()?.get(GLYPH_SET_KEY, DEFAULT_GLYPH_SET))]
}
