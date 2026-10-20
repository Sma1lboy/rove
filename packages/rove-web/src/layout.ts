/**
 * Layout state the TUI keeps in its KV (`sidebar.width`, `sidebar.collapsed`) and its focus
 * (narrow mode): the Tasks rail's pinned width and fold, and which single panel a narrow
 * viewport shows. Kept per browser, in px; one terminal cell is `CELL_PX` wide.
 */

import { NARROW_BREAKPOINT, narrowSurface } from "@sma1lboy/rove/src/tui-react/lib/narrow-mode.ts"
/** `view-core.ts`'s `SIDEBAR_WIDTH` and `MIN_WORKSPACE_WIDTH` (its import chain reaches `@/` aliases the page cannot resolve). */
const SIDEBAR_WIDTH = 24
const MIN_WORKSPACE_WIDTH = 40
import { useSyncExternalStore } from "react"
import { createStore } from "./store.ts"

/** The page's 12px monospace cell, roughly; the TUI's cell budgets are scaled by it. */
export const CELL_PX = 8
/** The Tasks rail's own minimum (`SIDEBAR_WIDTH` cells), and the fold's width. */
export const RAIL_MIN_PX = SIDEBAR_WIDTH * CELL_PX
/** The fold's width per style: the TUI's 2 / 4 / 7 cells (`COLLAPSED_RAIL_WIDTH`) plus the page's padding. */
const FOLDED_PX = { hairline: 20, glyphs: 48, initials: 76 } as const
export const foldedPx = (style: keyof typeof FOLDED_PX): number => FOLDED_PX[style]
const NARROW_QUERY = `(max-width: ${NARROW_BREAKPOINT * CELL_PX - 1}px)`
const WIDTH_KEY = "rove.web.railWidth"
const FOLD_KEY = "rove.web.railFolded"

function loadWidth(): number | null {
  const raw = Number(localStorage.getItem(WIDTH_KEY))
  return Number.isFinite(raw) && raw > 0 ? raw : null
}

/** The user's dragged width; null = the automatic width. */
export const railWidth = createStore<number | null>(loadWidth())
railWidth.subscribe(() => {
  const width = railWidth.get()
  if (width === null) localStorage.removeItem(WIDTH_KEY)
  else localStorage.setItem(WIDTH_KEY, String(Math.round(width)))
})

export const railFolded = createStore<boolean>(localStorage.getItem(FOLD_KEY) === "1")
railFolded.subscribe(() => localStorage.setItem(FOLD_KEY, railFolded.get() ? "1" : "0"))

/** The pin, clamped on every read like `resolveSidebarWidth`: a pin survives a narrow window and returns when it widens. */
export function clampRailWidth(px: number, viewport = window.innerWidth): number {
  const max = Math.max(RAIL_MIN_PX, viewport - MIN_WORKSPACE_WIDTH * CELL_PX)
  return Math.max(RAIL_MIN_PX, Math.min(max, Math.round(px)))
}

/** Narrow mode: which panel is up. The list is where a cold start lands, with the Recent row to go back. */
export const narrowPane = createStore<"sidebar" | "workspace">("sidebar")

export const enterWorkspace = (): void => narrowPane.set("workspace")
export const backToTasks = (): void => narrowPane.set("sidebar")

const narrowQuery = window.matchMedia(NARROW_QUERY)

export function useNarrow(): boolean {
  return useSyncExternalStore(
    (notify) => {
      narrowQuery.addEventListener("change", notify)
      return () => narrowQuery.removeEventListener("change", notify)
    },
    () => narrowQuery.matches,
  )
}

/** The TUI's `narrowSurface`: the list when it is the focused panel, else the content once there is a task or a page. */
export function surfaceFor(pane: "sidebar" | "workspace", hasTask: boolean, hasPage: boolean): "sidebar" | "content" {
  return narrowSurface({ focusedPane: pane, hasSelection: hasTask, hasOpenPage: hasPage })
}
