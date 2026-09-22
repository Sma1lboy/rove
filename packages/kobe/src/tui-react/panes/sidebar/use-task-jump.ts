/**
 * `ctrl+<digit>` for ONE sidebar surface: the digit a row prints and the row
 * it reaches come from the same list. Every surface that prints digits must
 * call this (folding UNMOUNTS the tree, so the fold registers its own). Both
 * surfaces number the same TASKS; the list is the rows wearing those digits.
 * Invariant: the number you READ is the number that moves you.
 *
 * Not gated on focus: the chord switches tasks from inside the engine pane.
 */

import { jumpSlotTarget } from "../../../tui/panes/sidebar/jump-digits"
import { bindByIds } from "../../context/keybindings"
import { useBindings } from "../../lib/keymap"
import { useLatest } from "../../lib/use-latest"

export interface TaskJumpOpts {
  /** Rows this surface prints a digit on, in render order; read via ref at
   *  keypress time so a chord between renders lands on what is on screen. */
  readonly ids: readonly string[]
  /** Enter the row a slot reached. */
  readonly onJump: (id: string, slot: number) => void
}

export function useTaskJump(opts: TaskJumpOpts): void {
  const idsRef = useLatest(opts.ids)
  const onJumpRef = useLatest(opts.onJump)
  useBindings(() => ({
    enabled: true,
    bindings: bindByIds({
      "tasks.jump": (_evt, slot) => {
        const index = slot ?? 0
        // A slot past the digit table (a row with no digit) reaches nothing.
        const id = jumpSlotTarget(idsRef.current, index)
        if (id === undefined) return
        onJumpRef.current(id, index)
      },
    }),
  }))
}
