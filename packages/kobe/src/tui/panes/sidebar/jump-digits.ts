/**
 * `ctrl+<digit>` jump digits, shared by chord table, key handler and row
 * renderer so a row's printed digit is the one that jumps to it.
 *
 * `1` is absent: legacy terminal protocol has no ctrl+1 encoding (only
 * ctrl+2…ctrl+8 map to C0 bytes; 1, 9, 0 send nothing; verified on the owner's
 * terminal). Rows print their own digit (row 1 shows `2`). Past the ninth: none.
 */
export const TASK_JUMP_DIGITS: readonly string[] = ["2", "3", "4", "5", "6", "7", "8", "9", "0"]

/** The chords the binding table registers, in slot order (slot N → row N). */
export const TASK_JUMP_CHORDS: readonly string[] = TASK_JUMP_DIGITS.map((d) => `ctrl+${d}`)

/** The digit shown on (and jumping to) a row, or null past the ninth. */
export function taskJumpDigit(rowIndex: number): string | null {
  return TASK_JUMP_DIGITS[rowIndex] ?? null
}

/**
 * Row a slot reaches in the surface's own digit-bearing list (the tree numbers
 * every navigable row, the folded rail its tasks). A slot past the table
 * printed no digit, so it reaches nothing, not whatever sits at that index.
 */
export function jumpSlotTarget(ids: readonly string[], slot: number): string | undefined {
  if (!Number.isInteger(slot) || slot < 0 || slot >= TASK_JUMP_DIGITS.length) return undefined
  return ids[slot]
}
