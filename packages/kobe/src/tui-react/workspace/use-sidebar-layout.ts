/**
 * The rail's persisted layout — its width and its fold — and the one place
 * anything is allowed to ask for either.
 *
 * Three surfaces size themselves off the width and they have to agree: the
 * rail itself, the prefix HUD that caps its lines to the rail, and the files
 * pane — which takes what's LEFT (`terminal − rail`). Let those derive the
 * width separately and a drag tears the layout: the rail moves, the pane
 * beside it doesn't, and the gap is either a dead column or an overlap.
 *
 * So the hook is the source of truth, not `resolveSidebarWidth` — the pure
 * function can't know about the pin, and a call site that reads only the
 * terminal width is exactly the bug above.
 *
 * Both read straight out of the KV store rather than mirroring it into
 * component state: `kv.set` re-renders every consumer under the provider, so a
 * copy buys nothing and can disagree with the file for a frame. It also lets
 * the rail's own mount and the frame-level grip read ONE fold, which they must
 * — the grip may not exist while the rail is folded.
 */

import { useTerminalDimensions } from "@opentui/react"
import { SIDEBAR_COLLAPSED_KEY, SIDEBAR_WIDTH_KEY } from "../../state/sidebar-collapsed.ts"
import { resolveSidebarWidth } from "../../tui/panes/sidebar/view-core"
import { useKV } from "../context/kv"

/** A stored pin that isn't a usable number falls back to the derived width. */
function storedOverride(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null
}

export interface SidebarWidthHandle {
  /** Width to render at, pin and terminal already reconciled. */
  readonly width: number
  /** Is a pin in effect (as opposed to the derived width)? */
  readonly pinned: boolean
  /** Pin a width. Clamping happens on read, so the raw drag target is stored. */
  readonly pin: (width: number) => void
  /** Drop the pin — back to following the terminal. */
  readonly reset: () => void
}

export function useSidebarWidth(): SidebarWidthHandle {
  const kv = useKV()
  const dims = useTerminalDimensions()
  const override = storedOverride(kv.get(SIDEBAR_WIDTH_KEY, null))
  return {
    width: resolveSidebarWidth(dims.width, override),
    pinned: override != null,
    pin: (width: number) => kv.set(SIDEBAR_WIDTH_KEY, width),
    reset: () => kv.set(SIDEBAR_WIDTH_KEY, null),
  }
}

/** Is the rail folded to its strip, and the setter that folds it. */
export function useSidebarCollapsed(): readonly [boolean, (next: boolean) => void] {
  const kv = useKV()
  return [kv.get(SIDEBAR_COLLAPSED_KEY, false) === true, (next: boolean) => kv.set(SIDEBAR_COLLAPSED_KEY, next)]
}
