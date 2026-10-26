/** The side panel's open state, width and views, plus the narrow mode's content view. Kept per browser, in px. */

import { CELL_PX, MIN_WORKSPACE_WIDTH } from "./layout.ts"
import { createStore } from "./store.ts"

/** The side panel's kinds of view; a tab is one instance of a kind. */
export const PANEL_KINDS = ["files", "diff", "browser"] as const
export type PanelKind = (typeof PANEL_KINDS)[number]
/** Narrow mode, a task's content panel: the terminal, or one of the side panel's kinds (the desktop's right column). */
export type NarrowView = "terminal" | PanelKind
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
