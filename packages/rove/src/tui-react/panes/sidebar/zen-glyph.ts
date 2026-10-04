/**
 * The ZEN chip's leading glyph, resolved per platform.
 *
 * `☯` (U+262F) is `Emoji=Yes, Emoji_Presentation=No`: macOS resolves it to the
 * narrow monochrome text glyph the chip was drawn around. Linux fontconfig
 * hands the same code point to Noto Color Emoji by default — a colored,
 * roughly double-width sprite that spills out of the ONE cell
 * `lib/display-width.ts` reserves for it and paints over the `ZEN` beside it.
 *
 * Nothing in a TUI can ask the terminal which font it actually picked: the
 * emoji still ADVANCES a single cell, so even a cursor-position probe reports
 * "fine" while the pixels overlap. The platform is the only signal available,
 * so off macOS we spend it on a glyph that has no emoji presentation to fall
 * into — the Geometric Shapes block's half-filled circles carry no emoji
 * presentation at all (only `▪▫▶◀◻◼◽◾` in that block do), and `◐` keeps the
 * half-dark/half-light reading the chip is named for.
 */
export function zenChipGlyph(platform: NodeJS.Platform = process.platform): string {
  return platform === "darwin" ? "☯" : "◐"
}
