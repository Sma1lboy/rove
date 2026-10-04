/**
 * Zen collapses the workspace to the engine pane (hides the Files column); the
 * Tasks rail stays, carrying the exit affordance. Intent persists under
 * `zen.active`, which Settings → "Start in zen mode" edits too (startup default
 * and live mirror at once). Goes through the KV context, not `state/zen.ts`, so
 * it shares the Settings dialog's cache instead of disagreeing until reload.
 */

import { useEffect, useState } from "react"
import { ZEN_ACTIVE_KEY } from "../../state/zen.ts"
import type { FocusContextValue } from "../context/focus"
import type { KVContext } from "../context/kv"

export type ZenMode = {
  readonly zen: boolean
  /** Flip zen and persist the new intent. */
  toggleZen: () => void
}

export function useZenMode(deps: { kv: KVContext; focus: FocusContextValue }): ZenMode {
  const { kv, focus } = deps
  const [zen, setZen] = useState(() => kv.get(ZEN_ACTIVE_KEY, false) === true)

  function toggleZen(): void {
    const next = !zen
    setZen(next)
    kv.set(ZEN_ACTIVE_KEY, next)
    if (next) focus.setFocused("workspace")
  }

  // Reaching the file tree drops zen for this session WITHOUT persisting:
  // a transient reaction, or one click would silently clear "Start in zen mode".
  useEffect(() => {
    if (focus.focused === "files") setZen(false)
  }, [focus.focused])

  return { zen, toggleZen }
}
