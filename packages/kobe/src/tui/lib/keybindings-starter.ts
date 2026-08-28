/**
 * The starter `keybindings.yaml` Rove writes on request from Settings →
 * Keybindings.
 *
 * The section used to PRINT this example and leave the user to create the file
 * themselves — twelve dead lines on screen, a path that wrapped across two of
 * them, and a retyping job. The same text is worth more inside the file, where
 * it sits next to what you are actually writing.
 *
 * Everything is commented out, so creating the file cannot change behavior: an
 * empty override set applies nothing. That is what makes the action safe to
 * offer behind a single keypress.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { DEFAULT_PREFIX_CONFIGURATION } from "./keymap-dispatch"

export const KEYBINDINGS_STARTER = `# Rove keybindings — every line below is an example, commented out.
# Uncomment what you want; changes reload live, no restart.
# Press F1 in Rove for the live keymap with every binding id.
#
# prefix:
#   key: ${DEFAULT_PREFIX_CONFIGURATION.key}                 # first stroke (null disables the layer)
#   timeoutMs: ${DEFAULT_PREFIX_CONFIGURATION.timeoutMs}             # second-stroke deadline
#   bindings:
#     chat.tab.new: t           # ${DEFAULT_PREFIX_CONFIGURATION.key}, then t
#
# bindings:
#   chat.fork.new: ctrl+g       # a string = one chord
#   sidebar.select: [enter]     # a list = several chords
#   files.createPR: null        # null = unbind
#
# darwin:                       # platform overlay (also: linux)
#   bindings:
#     palette.open: [cmd+p, ctrl+p]
`

/**
 * Write the starter file unless one is already there. Returns whether it
 * created anything, so the caller can tell "made you one" from "it existed".
 * Throws only on a real I/O failure — the caller surfaces that.
 */
export function createKeybindingsFile(path: string): boolean {
  if (existsSync(path)) return false
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, KEYBINDINGS_STARTER)
  return true
}
