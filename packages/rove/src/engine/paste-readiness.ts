/**
 * When a hosted engine is actually safe to paste a large prompt into.
 *
 * A cold engine's pty starts in CANONICAL mode with nothing draining it; the
 * canonical buffer is `MAX_INPUT` (1024 bytes on macOS) and a write past it
 * is DISCARDED, not blocked. Measured: a `Bun.spawn` pty whose child had not
 * yet run `stty raw` received exactly 1024 of 8600 bytes on every run.
 *
 *  - Chunking does NOT fix it: 512-byte chunks with gaps lose the same 1024
 *    bytes, since nothing drains the buffer.
 *  - Once the engine is RAW and reading, one write is safe: 8.6KB, 64KB,
 *    256KB and 1MB all arrived whole.
 *
 * So the fix is WHEN. An engine emits `\x1b[?2004h` (DECSET 2004, bracketed
 * paste on) only after entering raw mode and reading stdin, a direct
 * observation that it drains its tty. Measured: claude 258ms, codex 321ms,
 * kimi 1953ms; a shorter fixed settle drops kimi's prompt.
 *
 * Same contract as `pty-xterm-base.paste`: wrap in `\x1b[200~ … \x1b[201~`
 * only once the app has ASKED for it.
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

/** Wrap only when the engine asked: without DECSET 2004 it would render
 *  `\x1b[200~` as text. */
export function encodePaste(prompt: string, bracketed: boolean): string {
  return bracketed ? `\x1b[200~${prompt}\x1b[201~` : prompt
}
