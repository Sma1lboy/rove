/**
 * Digits for the `ctrl+<digit>` task jump — ONE definition shared by the
 * chord table, the key handler, and the row renderer, so the number a row
 * prints is always the number that actually jumps to it.
 *
 * `1` is deliberately absent. Ctrl+1 has no encoding in the legacy
 * terminal protocol (only ctrl+2…ctrl+8 map to C0 bytes; 1, 9 and 0 send
 * nothing), so it can't be relied on — verified on the owner's terminal.
 * Rather than leave the first row unreachable or make people compute an
 * offset, the row PRINTS its own digit: row 1 shows `2`, and the mapping
 * needs no memorising.
 *
 * Rows past the ninth get no digit rather than a wrong one.
 */
export const TASK_JUMP_DIGITS: readonly string[] = ["2", "3", "4", "5", "6", "7", "8", "9", "0"]

/** The chords the binding table registers, in slot order (slot N → row N). */
export const TASK_JUMP_CHORDS: readonly string[] = TASK_JUMP_DIGITS.map((d) => `ctrl+${d}`)

/** The digit shown on (and jumping to) a row, or null past the ninth. */
export function taskJumpDigit(rowIndex: number): string | null {
  return TASK_JUMP_DIGITS[rowIndex] ?? null
}

/**
 * The row a jump slot reaches, in a surface's OWN ordered list of
 * digit-bearing rows.
 *
 * Which rows are in that list is the surface's business — the expanded tree
 * numbers every navigable row, so a task's tab rows take digits of their own;
 * the folded rail numbers its tasks, because one cell per task is every row a
 * fold draws. What is NOT the surface's business is the arithmetic, which is
 * why it lives beside the digit table: a slot past the table names a row that
 * printed no digit, and must reach nothing rather than the row that happens to
 * sit at that index.
 */
export function jumpSlotTarget(ids: readonly string[], slot: number): string | undefined {
  if (!Number.isInteger(slot) || slot < 0 || slot >= TASK_JUMP_DIGITS.length) return undefined
  return ids[slot]
}
