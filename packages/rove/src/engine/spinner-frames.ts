/**
 * The ONE spinner frame set for running rows.
 *
 * No per-engine sets. Without the dingbat block (FiraCode Nerd Font), macOS
 * falls Claude Code's `·→✢→✱→✶→✻→✽` back to ZapfDingbats at a DIFFERENT
 * advance per glyph (1.11 / 1.13 / 1.15 / 1.21 / 1.28 cells), jittering the
 * row at 10Hz. Braille falls back as ONE face (AppleBraille, 1.11 cells every
 * frame). A new set must show equal per-frame advance in real fonts.
 *
 * Must stay importable from vitest and MUST NOT import from `src/tui/`.
 */

/** The braille dots every engine animates with. */
export const DEFAULT_SPINNER_FRAMES: readonly string[] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
