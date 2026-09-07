/**
 * Raw PTY bytes → readable rows. The one definition, shared by every reader
 * that turns a captured terminal stream back into lines: the durable death
 * record's tail (`pty-exit-store.ts`) and the `read-output` verb
 * (`kobe/src/cli/api/read-output-page.ts`).
 *
 * The subtlety is that a full-screen TUI does not write newlines. A shell
 * ends every row with `\n`, so splitting on it recovers the screen — but an
 * engine in the alternate screen positions its cursor with CSI instead
 * (`ESC[1B` down a row, `ESC[H` home), and emits no `\n` at all for a screen
 * it is painting. Strip the escapes first, as a plain `replace(ANSI_RE, "")`
 * does, and every row of that screen concatenates into ONE line — then the
 * caller's "keep the last N lines" budget keeps 1 line where it meant to keep
 * 40, and what survives is whatever the engine painted LAST (a footer, a
 * `Enter to confirm · Esc to cancel`) with the question it belongs to
 * discarded.
 *
 * So vertical cursor motion becomes a row break BEFORE the escapes are
 * stripped. This is not a terminal emulator and does not try to be: absolute
 * positioning is treated as "some other row", not as the row it names, so a
 * screen repainted out of order reads out of order. It recovers the ROWS,
 * which is what a tail budget needs to count.
 */

/** CSI cursor-down (`B`) / next-line (`E`), with an optional repeat count. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching raw ANSI escapes is the point
const CURSOR_DOWN_RE = /\x1b\[(\d*)[BE]/g
/** CSI absolute cursor position (`H` / `f`) — a move to some other row. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching raw ANSI escapes is the point
const CURSOR_POSITION_RE = /\x1b\[[\d;]*[Hf]/g
/** Bound the rows one escape can synthesize, so a hostile `ESC[999999B`
 *  cannot turn a short capture into a huge array. A real screen is ~50 rows. */
const MAX_ROWS_PER_ESCAPE = 200

// Same escape grammar every reader here strips: CSI, OSC, and the generic
// `ESC <intermediates> <final>` form. That last alternative used to be
// `\x1b[@-_]` (the C1 set only), which left the charset-select `ESC ( B` that
// every full-screen redraw emits sitting in the output as visible garbage.
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping raw ANSI escapes is the point
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[ -/]*[0-~]/g

/**
 * Bare control bytes no escape sequence introduces — a shell's BEL, a
 * spinner's backspace, a stray NUL. A terminal renders them as nothing, so
 * they survive unnoticed until something that is NOT a terminal reads the
 * text: `get-task`'s `exit.tail` shipped them to every API consumer, where
 * `jq -r`, a log file, or a diff each show a different kind of damage.
 * `\t` (\x09), `\n` (\x0a) and `\r` (\x0d) are the three that carry meaning
 * here — `\r` is the CR-overwrite {@link terminalRows} honours below — so
 * they stay; DEL rides along because it is invisible for the same reason.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping raw control bytes is the point
const CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g

/**
 * Raw terminal bytes → text safe to hand a non-terminal: escapes and bare
 * control bytes gone, line structure untouched.
 *
 * The one stripper — {@link terminalRows} is this plus row recovery, and the
 * durable exit store runs it over records written before it existed.
 */
export function stripTerminalControls(text: string): string {
  return text.replace(ANSI_RE, "").replace(CONTROL_RE, "")
}

/** Turn vertical cursor motion into newlines, so an alt-screen paint has rows
 *  to be split on. Must run BEFORE {@link ANSI_RE} deletes the escapes. */
function breakRowsOnCursorMotion(raw: string): string {
  return raw
    .replace(CURSOR_DOWN_RE, (_m, count: string) =>
      "\n".repeat(Math.min(MAX_ROWS_PER_ESCAPE, Math.max(1, Number.parseInt(count, 10) || 1))),
    )
    .replace(CURSOR_POSITION_RE, "\n")
}

/**
 * Raw PTY bytes → readable rows: recover alt-screen rows, strip ANSI, honor
 * CR overwrites. `maxLineChars` clips each row when the caller has a per-line
 * budget (the death record does; `read-output` does not).
 */
export function terminalRows(raw: string, maxLineChars?: number): string[] {
  const plain = stripTerminalControls(breakRowsOnCursorMotion(raw)).replace(/\r\n/g, "\n")
  return plain.split("\n").map((line) => {
    const overwritten = line.split("\r").pop() ?? ""
    return maxLineChars === undefined ? overwritten : overwritten.slice(0, maxLineChars)
  })
}
