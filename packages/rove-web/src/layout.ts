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
import { type PageId, page, railMoving } from "./ui.ts"

/** The page's 12px monospace cell, roughly; the TUI's cell budgets are scaled by it. */
export const CELL_PX = 8
/** The Tasks rail's own minimum (`SIDEBAR_WIDTH` cells). */
export const RAIL_MIN_PX = SIDEBAR_WIDTH * CELL_PX
/** The rail's width until one is dragged: a length, not a `minmax`, so folding can animate it to 0. */
export const RAIL_DEFAULT_PX = 280
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

/** A folded rail floating over the workspace while the pointer is at the left edge (Claude Desktop's peek). */
export const railPeek = createStore<boolean>(false)
let peekTimer: number | null = null
/** Open at once; close after a grace, so the pointer can cross the edge or the top-left bar without it flickering shut. */
export function peekRail(open: boolean): void {
  if (peekTimer !== null) window.clearTimeout(peekTimer)
  peekTimer = null
  if (open) railPeek.set(true)
  else peekTimer = window.setTimeout(() => railPeek.set(false), 250)
}
railFolded.subscribe(() => railPeek.set(false))

let movingTimer: number | null = null
railFolded.subscribe(() => {
  if (movingTimer !== null) window.clearTimeout(movingTimer)
  railMoving.set(true)
  movingTimer = window.setTimeout(() => railMoving.set(false), 240)
})

/** The pin, clamped on every read like `resolveSidebarWidth`: a pin survives a narrow window and returns when it widens. */
export function clampRailWidth(px: number, viewport = window.innerWidth): number {
  const max = Math.max(RAIL_MIN_PX, viewport - MIN_WORKSPACE_WIDTH * CELL_PX)
  return Math.max(RAIL_MIN_PX, Math.min(max, Math.round(px)))
}

/** Narrow mode: which panel is up. The list is where a cold start lands, with the Recent row to go back. */
export const narrowPane = createStore<"sidebar" | "workspace">("sidebar")

export const enterWorkspace = (): void => narrowPane.set("workspace")
export const backToTasks = (): void => narrowPane.set("sidebar")
/** Open a page and, in narrow mode, show it: a page left open behind the list sets to the same value and fires nothing. */
export function openPage(id: PageId): void {
  page.set(id)
  enterWorkspace()
}
/** The side panel's views, left to right in its button row. */
export const PANEL_TABS = ["files", "diff", "browser"] as const
export type PanelTab = (typeof PANEL_TABS)[number]
/** Narrow mode, a task's content panel: the terminal, or one of the side panel's views (the desktop's right column). */
export type NarrowView = "terminal" | PanelTab
export const narrowView = createStore<NarrowView>("terminal")

/** The side panel's own minimum; the terminal keeps `MIN_WORKSPACE_WIDTH` of what is left. */
export const PANEL_MIN_PX = 280
const PANEL_WIDTH_KEY = "rove.web.panelWidth"
const PANEL_OPEN_KEY = "rove.web.panelOpen"

/** The user's dragged panel width; null = the automatic width. */
export const panelWidth = createStore<number | null>(
  (() => {
    const raw = Number(localStorage.getItem(PANEL_WIDTH_KEY))
    return Number.isFinite(raw) && raw > 0 ? raw : null
  })(),
)
panelWidth.subscribe(() => {
  const width = panelWidth.get()
  if (width === null) localStorage.removeItem(PANEL_WIDTH_KEY)
  else localStorage.setItem(PANEL_WIDTH_KEY, String(Math.round(width)))
})

/** The panel beside the terminal (zen still hides it); the button at the workspace's top right flips it. */
export const panelOpen = createStore<boolean>(localStorage.getItem(PANEL_OPEN_KEY) !== "0")
panelOpen.subscribe(() => localStorage.setItem(PANEL_OPEN_KEY, panelOpen.get() ? "1" : "0"))

/** The pin, clamped on every read like the rail's: it survives a narrow window and returns when it widens. */
export function clampPanelWidth(px: number, railPx: number, viewport = window.innerWidth): number {
  const max = Math.max(PANEL_MIN_PX, viewport - railPx - MIN_WORKSPACE_WIDTH * CELL_PX)
  return Math.max(PANEL_MIN_PX, Math.min(max, Math.round(px)))
}

const narrowQuery = window.matchMedia(NARROW_QUERY)
export const isNarrow = (): boolean => narrowQuery.matches

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
