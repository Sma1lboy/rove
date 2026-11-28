import { setNarrowBreakpoint } from "../../lib/narrow-mode"
/** @jsxImportSource @opentui/react */
import { NARROW_BELOW_KEY } from "../../state/narrow-layout"
import { useOptionalKV } from "../context/kv"

/**
 * Keeps the narrow breakpoint on the live `layout.narrowBelow`. Set during
 * render, not in an effect: mounted before the screen root, so the same pass
 * lays out against the new value.
 */
export function NarrowLayoutSync() {
  const kv = useOptionalKV()
  if (kv) setNarrowBreakpoint(kv.get(NARROW_BELOW_KEY))
  return null
}
