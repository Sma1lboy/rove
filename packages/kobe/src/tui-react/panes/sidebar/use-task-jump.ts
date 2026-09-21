/**
 * `ctrl+<digit>` for ONE sidebar surface: the digit a row prints and the row
 * that digit reaches, resolved from the same list.
 *
 * Those are one question, and they used to be answered in two places. The
 * expanded tree registered the chord against its own navigable rows; the
 * folded rail printed digits over its task strip and registered nothing at
 * all — and because folding UNMOUNTS the tree, the fold showed a number on
 * every row while `ctrl+2` did nothing. The default fold is the digits one,
 * whose whole claim is that the jump key is the one thing a folded row can
 * still be acted on.
 *
 * So the rule lives here, once, and a surface that prints digits calls this to
 * answer for them. What stays per-surface is the LIST: the expanded tree
 * numbers every navigable row including a task's tab rows, the fold numbers
 * its tasks, because those are the rows each one actually draws. A slot
 * therefore names a different row in the two states — see
 * `docs/design/keybinding-decisions.md`; the invariant is that the number you
 * READ is the number that moves you, not that a number survives a fold.
 *
 * Not gated on focus, exactly as before: the chord exists to switch tasks from
 * inside the engine pane.
 */

import { jumpSlotTarget } from "../../../tui/panes/sidebar/jump-digits"
import { bindByIds } from "../../context/keybindings"
import { useBindings } from "../../lib/keymap"
import { useLatest } from "../../lib/use-latest"

export interface TaskJumpOpts {
  /**
   * The rows this surface prints a digit on, in render order. Read through a
   * ref at keypress time rather than captured: the list rebuilds on every
   * daemon push and the 2s branch tick, and a chord pressed between renders
   * has to land on what is on screen now.
   */
  readonly ids: readonly string[]
  /** Enter the row a slot reached. `slot` rides along for a surface that also
   *  moves a cursor there. */
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
        // Resolved by the module that owns the digit table, so "which row does
        // this number reach" is answered the same way for every surface — and
        // a slot past the table (a row that printed no digit) reaches nothing.
        const id = jumpSlotTarget(idsRef.current, index)
        if (id === undefined) return
        onJumpRef.current(id, index)
      },
    }),
  }))
}
