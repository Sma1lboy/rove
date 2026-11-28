/** The side panel's open state, width and views, plus the narrow mode's content view. Kept per browser, in px. */

import { CELL_PX, MIN_WORKSPACE_WIDTH } from "./layout.ts"
import { PANEL_KINDS, type PanelKind } from "./panel-model.ts"
import { createStore } from "./store.ts"
import { slideLayout } from "./ui.ts"

/**
 * The kinds the top bar opens: desktop's launcher icons and the phone's switch both read this, so a kind
 * added or dropped here changes both. Chat opens from the side panel's + menu instead.
 */
export const LAUNCHED_KINDS = PANEL_KINDS.filter((kind) => kind !== "chat")
/** Narrow mode, a task's content panel: the terminal, or one of the side panel's kinds (the desktop's right column). */
export type NarrowView = "terminal" | PanelKind
export const narrowView = createStore<NarrowView>("terminal")

const PHONE_VIEW_KEY = "rove.web.phoneView"
/** Picks kept, newest last; older ones are forgotten. */
const PHONE_VIEW_KEPT = 200

/** Each session tab's last pick in the phone's view sheet, by `taskId::tabId`. */
function phoneViews(): Record<string, NarrowView> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(PHONE_VIEW_KEY) ?? "{}")
    return saved && typeof saved === "object" ? (saved as Record<string, NarrowView>) : {}
  } catch {
    return {}
  }
}

/** The phone opening a session tab: the view last picked there, else the terminal. */
export function openNarrowView(taskId: string | null, tabId: string | null): void {
  narrowView.set((taskId && tabId && phoneViews()[`${taskId}::${tabId}`]) || "terminal")
}

/** A pick in the phone's view sheet, remembered for that session tab. */
export function pickNarrowView(taskId: string, tabId: string | null, view: NarrowView): void {
  narrowView.set(view)
  if (!tabId) return
  const key = `${taskId}::${tabId}`
  const { [key]: _old, ...rest } = phoneViews()
  const kept = Object.entries({ ...rest, [key]: view }).slice(-PHONE_VIEW_KEPT)
  localStorage.setItem(PHONE_VIEW_KEY, JSON.stringify(Object.fromEntries(kept)))
}

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
panelWidth.subscribe(slideLayout)

/** The panel beside the terminal; the Files / Diff / Browser buttons at the workspace's top right open and close their columns. Off until a panel is first opened in this browser; from then each task's panel shows while that task has a column (`usePanelShown`), so one task closing its last column does not shut another's. */
export const panelOpen = createStore<boolean>(localStorage.getItem(PANEL_OPEN_KEY) === "1")
panelOpen.subscribe(() => localStorage.setItem(PANEL_OPEN_KEY, panelOpen.get() ? "1" : "0"))

/** The panel covers the terminal's column too. Per page load, and undone whenever a task's panel closes. */
export const panelExpanded = createStore<boolean>(false)
panelOpen.subscribe(() => {
  if (!panelOpen.get()) panelExpanded.set(false)
})

/** The pin, clamped on every read like the rail's: it survives a narrow window and returns when it widens. */
export function clampPanelWidth(px: number, railPx: number, viewport = window.innerWidth): number {
  const max = Math.max(PANEL_MIN_PX, viewport - railPx - MIN_WORKSPACE_WIDTH * CELL_PX)
  return Math.max(PANEL_MIN_PX, Math.min(max, Math.round(px)))
}
