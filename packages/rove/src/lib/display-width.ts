/**
 * Terminal display width — how many CELLS a string / code point occupies,
 * not `String.length` (UTF-16 units) or code-point count. Wide CJK / fullwidth
 * glyphs are common (Chinese-default UI), and length under-counts them.
 *
 * Framework-free so the `kobe export` table renderer and the embedded-terminal
 * cursor overlay (`terminal-render.ts`, mapping a cell column onto
 * code-point-indexed text) share ONE width table.
 */

/** Cell width of a single Unicode code point: 0 (zero-width), 2 (wide), or 1. */
export function charWidth(cp: number): number {
  // Non-printing controls: C0 (U+0000–U+001F), DEL (U+007F), C1 (U+0080–U+009F).
  // Non-printing per wcwidth. Callers must NOT re-floor to 1 (`|| 1`): the
  // terminal doesn't advance the cursor for these, and flooring breaks the
  // embedded terminal's cell math.
  if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return 0
  // Zero-width: combining marks + bidi/format controls + variation selectors.
  if (
    (cp >= 0x0300 && cp <= 0x036f) || // combining diacritical marks
    (cp >= 0x1160 && cp <= 0x11ff) || // conjoining Hangul Jamo (medial/final) — fold onto the leading jamo's cell
    (cp >= 0x1ab0 && cp <= 0x1aff) || // combining diacritical marks extended
    (cp >= 0x1dc0 && cp <= 0x1dff) || // combining diacritical marks supplement
    (cp >= 0x200b && cp <= 0x200f) || // zero-width space … LTR/RTL marks
    (cp >= 0x202a && cp <= 0x202e) || // bidi embedding / override
    (cp >= 0x2060 && cp <= 0x2064) || // word joiner … invisible operators
    (cp >= 0x20d0 && cp <= 0x20ff) || // combining marks for symbols
    (cp >= 0x302a && cp <= 0x302f) || // ideographic + Hangul tone marks (xterm wcwidth: combining, zero-width)
    (cp >= 0x3099 && cp <= 0x309a) || // combining katakana-hiragana (semi-)voiced sound marks (NFD-decomposed が/ぱ)
    (cp >= 0xfe00 && cp <= 0xfe0f) || // variation selectors
    (cp >= 0xfe20 && cp <= 0xfe2f) || // combining half marks
    cp === 0xfeff // zero-width no-break space (BOM)
  ) {
    return 0
  }
  // Wide: East Asian Wide + Fullwidth + the common emoji / pictograph blocks.
  if (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo (leading/choseong) — medial/final fold to zero above
    cp === 0x2329 ||
    cp === 0x232a || // angle brackets
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals … Kangxi … CJK symbols — tone marks 302A–302F fold to zero above
    (cp >= 0x3041 && cp <= 0x33ff) || // Hiragana … Katakana … CJK compat — sound marks 3099/309A fold to zero above
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Unified Ext A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified Ideographs
    (cp >= 0xa000 && cp <= 0xa4cf) || // Yi Syllables
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul Syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK Compatibility Ideographs
    (cp >= 0xfe10 && cp <= 0xfe19) || // vertical forms
    (cp >= 0xfe30 && cp <= 0xfe6f) || // CJK compatibility forms
    (cp >= 0xff00 && cp <= 0xff60) || // Fullwidth forms
    (cp >= 0xffe0 && cp <= 0xffe6) || // Fullwidth signs
    cp === 0x1f004 || // Mahjong Tile Red Dragon (RGI emoji, EAW=W)
    cp === 0x1f0cf || // Playing Card Black Joker (RGI emoji, EAW=W)
    (cp >= 0x1f200 && cp <= 0x1f2ff) || // Enclosed Ideographic Supplement (EAW=W)
    (cp >= 0x1f300 && cp <= 0x1faff) || // emoji, symbols & pictographs
    (cp >= 0x20000 && cp <= 0x3fffd) // CJK Unified Ext B and beyond
  ) {
    return 2
  }
  return 1
}

/**
 * Terminal display width of `s` in cells. Iterates by code point (so astral
 * characters — CJK Extension B, emoji — count once, not as two UTF-16 units).
 */
export function displayWidth(s: string): number {
  let width = 0
  for (const ch of s) width += charWidth(ch.codePointAt(0) as number)
  return width
}

/**
 * FAST over-counting variant of {@link charWidth}: ≥ U+1100 counts 2, below
 * counts 1. Never under-counts CJK, but has no zero-width class and doubles
 * some narrow glyphs — fine for tooltips/legends where too-wide beats clipped.
 * Use {@link charWidth}/{@link displayWidth} for exact cell math.
 */
export function approxCharCells(cp: number): 1 | 2 {
  return cp >= 0x1100 ? 2 : 1
}

/** {@link approxCharCells} summed over a string's code points. */
export function approxCellWidth(s: string): number {
  let n = 0
  for (const ch of s) n += approxCharCells(ch.codePointAt(0) ?? 0)
  return n
}

/**
 * `String.padEnd` against a display-CELL target (padEnd counts UTF-16 code
 * units, so a wide CJK glyph or a `⌘`-class chord under-pads and misaligns
 * every column to its right). Already-wide strings pass through unchanged.
 */
export function padEndCells(s: string, cells: number): string {
  const deficit = cells - displayWidth(s)
  return deficit <= 0 ? s : s + " ".repeat(deficit)
}
