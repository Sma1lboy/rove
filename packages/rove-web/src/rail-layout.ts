/**
 * The Tasks rail's pinned width and fold, which the TUI keeps in its KV (`sidebar.width`,
 * `sidebar.collapsed`). Kept per browser, in px.
 */

import { CELL_PX, MIN_WORKSPACE_WIDTH } from "./layout.ts"
import { createStore } from "./store.ts"
import { railMoving } from "./ui.ts"

const SIDEBAR_WIDTH = 24

/** The Tasks rail's own minimum (`SIDEBAR_WIDTH` cells). */
export const RAIL_MIN_PX = SIDEBAR_WIDTH * CELL_PX
/** The rail's width until one is dragged: a length, not a `minmax`, so folding can animate it to 0. */
export const RAIL_DEFAULT_PX = 280
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
