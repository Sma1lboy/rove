/** The bindings Settings → Keybindings can rebind (TUI and web): not the fixed ones, not the doc-only rows. */

import { defaultKeymapCopy } from "../context/keybindings"
import { groupBindings } from "./help-groups"
import { FIXED_BINDING_IDS } from "./keymap-overrides"

export function editableBindings(): ReturnType<typeof defaultKeymapCopy> {
  const editable = defaultKeymapCopy().filter(
    (row) => !(row.id in FIXED_BINDING_IDS) && (row.keys.length > 0 || row.prefixKeys !== undefined),
  )
  // Category by category, as the section draws them, so a cursor walks the rows in drawn order.
  return groupBindings(editable).flatMap((group) => [...group.rows])
}
