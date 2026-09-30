import { DEFAULT_GLYPH_SET, GLYPH_SET_KEY, normalizeGlyphSet } from "../../state/glyph-set"
import { GLYPH_SETS, type GlyphSet } from "../../tui/lib/glyphs"
import { useOptionalKV } from "../context/kv"

/** The glyph preset from Settings; braille without a KV provider. */
export function useGlyphs(): GlyphSet {
  return GLYPH_SETS[normalizeGlyphSet(useOptionalKV()?.get(GLYPH_SET_KEY, DEFAULT_GLYPH_SET))]
}
