/**
 * Raw PTY bytes → readable rows, shared by the death record's tail
 * (`pty-exit-store.ts`) and `read-output` (`kobe/src/cli/api/read-output-page.ts`).
 *
 * A full-screen TUI writes no `\n`: in the alternate screen it moves the
 * cursor with CSI (`ESC[1B`, `ESC[H`). Stripping escapes first joins the whole
 * screen into ONE line, so a "last 40 lines" budget keeps 1 line — whatever
 * was painted last (a footer, `Enter to confirm · Esc to cancel`) — and drops
 * the question. So vertical motion becomes a row break before stripping.
 * Not an emulator: absolute positioning is just "another row", so an
 * out-of-order repaint reads out of order. It recovers rows, which is what a
 * tail budget counts.
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

// CSI, OSC, and generic `ESC <intermediates> <final>`. The last must cover
// more than C1 (`\x1b[@-_]`): every full-screen redraw emits charset-select
// `ESC ( B`, which would otherwise survive as visible garbage.
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping raw ANSI escapes is the point
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[ -/]*[0-~]/g

/**
 * Bare control bytes (BEL, a spinner's backspace, NUL): invisible in a
 * terminal, damage in `jq -r`, logs and diffs. `\t`, `\n` and `\r` stay —
 * `\r` is the CR-overwrite {@link terminalRows} honours; DEL goes too.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping raw control bytes is the point
const CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g

/**
 * Raw terminal bytes → text safe for a non-terminal: escapes and bare control
 * bytes gone, line structure untouched. The exit store also runs it over
 * records persisted unstripped.
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
