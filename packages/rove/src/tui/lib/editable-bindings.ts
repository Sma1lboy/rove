/** The bindings Settings → Keybindings can rebind (TUI and web): every row but the doc-only ones. */

import { defaultKeymapCopy } from "../context/keybindings"
import { groupBindings } from "./help-groups"

export function editableBindings(): ReturnType<typeof defaultKeymapCopy> {
  const editable = defaultKeymapCopy().filter((row) => row.keys.length > 0 || row.prefixKeys !== undefined)
  // Category by category, as the section draws them, so a cursor walks the rows in drawn order.
  return groupBindings(editable).flatMap((group) => [...group.rows])
}
