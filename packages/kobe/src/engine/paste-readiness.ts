/**
 * When a hosted engine is actually safe to paste a large prompt into.
 *
 * The bug this exists for (9 tasks dispatched with an empty prompt): a cold
 * engine's pty starts in CANONICAL mode with nothing draining it. The tty's
 * canonical input buffer is `MAX_INPUT` (1024 bytes on macOS), and a write
 * past it is DISCARDED, not blocked — so an 8.6KB prompt written into that
 * window arrives as a 1024-byte prefix and the rest is gone. Measured, not
 * theorised: a `Bun.spawn` pty whose child had not yet run `stty raw`
 * received exactly 1024 of 8600 bytes on every run.
 *
 * Two things follow, and the second is the one that matters:
 *
 *  - Chunking does NOT fix it. 512-byte chunks with a gap between them lost
 *    exactly the same 1024 bytes — the buffer is never drained, so slower
 *    writing just refills a full buffer. The old plan of "write in chunks"
 *    would have shipped a no-op.
 *  - Once the engine is in RAW mode and reading, a single write is safe at
 *    any size we care about — 8.6KB, 64KB, 256KB and 1MB all arrived whole.
 *
 * So the fix is not how we write, it is WHEN. `\x1b[?2004h` (DECSET 2004,
 * bracketed paste on) is emitted by an engine only after it has taken the
 * terminal into raw mode and started reading stdin, which makes it a direct
 * observation of "this process is draining its tty" rather than a guess.
 * Measured against the three real engines: claude 258ms, codex 321ms, kimi
 * 1953ms — kimi lands AFTER the old hardcoded 1500ms settle, which is
 * exactly why kimi was the vendor that lost prompts.
 *
 * It doubles as the bracketed-paste contract the interactive path already
 * honours (`pty-xterm-base.paste`): wrapping in `\x1b[200~ … \x1b[201~` is
 * only correct once the app has ASKED for it.
 */

/** DECSET 2004 set — the engine turned bracketed paste on. */
const BRACKETED_PASTE_ON = "\x1b[?2004h"
/** DECSET 2004 reset — emitted while a full-screen app is suspended. */
const BRACKETED_PASTE_OFF = "\x1b[?2004l"

/** Longest observed real-engine time to bracketed paste is ~2s (kimi); this
 *  leaves generous room for a loaded machine before we fall back. */
export const PASTE_READY_TIMEOUT_MS = 15_000
/** Ring poll interval while waiting for the mode announcement. */
export const PASTE_READY_POLL_MS = 100

/**
 * Whether `output` leaves the engine in bracketed-paste mode — the LAST
 * 2004h/2004l wins, so an engine that turned it on at boot and off again
 * (suspended into a pager/editor) correctly reads as not-ready.
 */
export function bracketedPasteActive(output: string): boolean {
  const on = output.lastIndexOf(BRACKETED_PASTE_ON)
  if (on === -1) return false
  return on > output.lastIndexOf(BRACKETED_PASTE_OFF)
}

/** Wrap `prompt` for an engine that asked for bracketed paste; send it bare
 *  otherwise. Mirrors the interactive backend's conditional wrapping — an
 *  engine that never enabled DECSET 2004 would render `\x1b[200~` as text. */
export function encodePaste(prompt: string, bracketed: boolean): string {
  return bracketed ? `\x1b[200~${prompt}\x1b[201~` : prompt
}
