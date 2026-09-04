/**
 * The ONE spinner frame set for running rows.
 *
 * There is no per-engine brand frame set, and adding one means adding a
 * registry field for it. On a font without the dingbat block (FiraCode Nerd
 * Font) macOS falls Claude Code's `·→✢→✱→✶→✻→✽` oscillation back to
 * ZapfDingbats at a DIFFERENT advance per glyph (1.11 / 1.13 / 1.15 / 1.21 /
 * 1.28 cells), so a running row jitters at 10Hz. Braille falls back as ONE
 * face (AppleBraille, 1.11 cells for every frame): uniform even when it isn't
 * the base font, which is the property a frame set actually needs.
 *
 * Measure a candidate's per-frame advance in the fonts people run before
 * introducing one — equal advance across frames is the bar, not "the vendor
 * uses it".
 *
 * Must stay importable from vitest and MUST NOT import from `src/tui/`.
 */

/** The braille dots every engine animates with. */
export const DEFAULT_SPINNER_FRAMES: readonly string[] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
