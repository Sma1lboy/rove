/** Whether the Files pane shows beside the workspace. Persisted, hidden until first opened. */

import { useEffect, useState } from "react"
import { FILES_OPEN_KEY } from "../../state/files-pane.ts"
import type { FocusContextValue } from "../context/focus"
import type { KVContext } from "../context/kv"

export type FilesPane = {
  readonly open: boolean
  /** Show or hide the pane and persist it. */
  toggle: () => void
}

export function useFilesPane(deps: { kv: KVContext; focus: FocusContextValue }): FilesPane {
  const { kv, focus } = deps
  const [open, setOpen] = useState(() => kv.get(FILES_OPEN_KEY, false) === true)

  function toggle(): void {
    const next = !open
    setOpen(next)
    kv.set(FILES_OPEN_KEY, next)
    // A hidden pane cannot keep the focus.
    if (!next && focus.focused === "files") focus.setFocused("workspace")
  }

  // Something focused the file tree: it has to be on screen.
  useEffect(() => {
    if (focus.focused === "files") setOpen(true)
  }, [focus.focused])

  return { open, toggle }
}
