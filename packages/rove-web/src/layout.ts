/**
 * The viewport and the TUI's narrow mode (its focus): which single panel a narrow viewport shows.
 * The rail's and the side panel's own sizes live in `rail-layout.ts` and `panel-layout.ts`.
 * One terminal cell is `CELL_PX` wide.
 */

import { NARROW_BREAKPOINT, narrowSurface } from "@sma1lboy/rove/src/tui-react/lib/narrow-mode.ts"
import { useSyncExternalStore } from "react"
import { createStore } from "./store.ts"
import { type PageId, page } from "./ui.ts"

/** The page's 12px monospace cell, roughly; the TUI's cell budgets are scaled by it. */
export const CELL_PX = 8
/** `view-core.ts`'s `MIN_WORKSPACE_WIDTH` (its import chain reaches `@/` aliases the page cannot resolve). */
export const MIN_WORKSPACE_WIDTH = 40
const NARROW_QUERY = `(max-width: ${NARROW_BREAKPOINT * CELL_PX - 1}px)`

/** Narrow mode: which panel is up. The list is where a cold start lands, with the Recent row to go back. */
export const narrowPane = createStore<"sidebar" | "workspace">("sidebar")

export const enterWorkspace = (): void => narrowPane.set("workspace")
export const backToTasks = (): void => narrowPane.set("sidebar")
/** Open a page and, in narrow mode, show it: a page left open behind the list sets to the same value and fires nothing. */
export function openPage(id: PageId): void {
  page.set(id)
  enterWorkspace()
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
