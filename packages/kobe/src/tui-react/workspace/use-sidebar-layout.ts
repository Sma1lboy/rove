/**
 * The rail's persisted width and fold, and the ONLY place to ask for either.
 * The rail, the prefix HUD (caps lines to it) and the files pane (takes
 * `terminal − rail`) must agree, or a drag leaves a dead column or overlap; the
 * pure `resolveSidebarWidth` can't see the pin, so it isn't the source of truth.
 * Reads KV directly (`kv.set` re-renders every consumer), so no copy can lag a
 * frame, and the rail and the grip read ONE fold (the grip may not exist while
 * folded).
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
  /** Stores the raw drag target; clamping happens on read. */
  readonly pin: (width: number) => void
  /** Back to following the terminal. */
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
