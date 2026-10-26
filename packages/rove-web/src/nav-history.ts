/**
 * Back / forward over where the workspace has been: a task, a page, or the New session composer, as
 * Claude Desktop's arrows. In memory only; the browser's own history is left alone (the token lives in it).
 */

import type { AppModel } from "./model.ts"
import { createStore } from "./store.ts"
import { type NewSessionStart, type PageId, newSession, page } from "./ui.ts"

export type NavPlace =
  | { readonly kind: "task"; readonly taskId: string; readonly tabId: string | null }
  | { readonly kind: "page"; readonly id: PageId }
  | { readonly kind: "new"; readonly start: NewSessionStart }

const MAX = 50

/** Entries by place, not tab: switching tabs inside a task is not a step. */
export function samePlace(a: NavPlace, b: NavPlace): boolean {
  if (a.kind === "task" && b.kind === "task") return a.taskId === b.taskId
  if (a.kind === "page" && b.kind === "page") return a.id === b.id
  return a.kind === "new" && b.kind === "new"
}

/** The stack and its cursor, pure so the rules are testable without stores. */
export interface NavState {
  readonly entries: readonly NavPlace[]
  readonly at: number
}

export const emptyNav: NavState = { entries: [], at: -1 }

/** A new place truncates anything forward of the cursor; the same place only refreshes its tab. */
export function visit(state: NavState, place: NavPlace): NavState {
  const here = state.entries[state.at]
  if (here && samePlace(here, place)) {
    const entries = [...state.entries]
    entries[state.at] = place
    return { entries, at: state.at }
  }
  const entries = [...state.entries.slice(0, state.at + 1), place].slice(-MAX)
  return { entries, at: entries.length - 1 }
}

/** The nearest live entry in `dir` from the cursor, or -1. */
export function step(state: NavState, dir: -1 | 1, live: (place: NavPlace) => boolean): number {
  for (let i = state.at + dir; i >= 0 && i < state.entries.length; i += dir) {
    const place = state.entries[i]
    if (place && live(place)) return i
  }
  return -1
}

export const navState = createStore<NavState>(emptyNav)

function currentPlace(model: AppModel): NavPlace | null {
  const id = page.get()
  if (id) return { kind: "page", id }
  const start = newSession.get()
  if (start) return { kind: "new", start }
  const { taskId, tabId } = model.selection.get()
  return taskId ? { kind: "task", taskId, tabId } : null
}

/** A task still listed and not being deleted; pages and the composer are always reachable. */
export function isLive(model: AppModel, place: NavPlace): boolean {
  if (place.kind !== "task") return true
  const task = model.tasks.get()?.tasks.find((row) => row.id === place.taskId)
  return task !== undefined && !task.deleting
}

let traversing = false

/**
 * Records each settled place. One click can fire several stores (a selection clears the page and the
 * composer), so the record waits a microtask and reads where things ended up.
 */
export function trackNav(model: AppModel): () => void {
  let queued = false
  const record = () => {
    if (queued) return
    queued = true
    queueMicrotask(() => {
      queued = false
      if (traversing) return
      const place = currentPlace(model)
      if (place) navState.set(visit(navState.get(), place))
    })
  }
  record()
  const offs = [model.selection.subscribe(record), page.subscribe(record), newSession.subscribe(record)]
  return () => {
    for (const off of offs) off()
  }
}

export function go(model: AppModel, dir: -1 | 1): void {
  const state = navState.get()
  const to = step(state, dir, (place) => isLive(model, place))
  const place = state.entries[to]
  if (!place) return
  traversing = true
  if (place.kind === "task") {
    page.set(null)
    newSession.set(null)
    model.select(place.taskId, place.tabId)
  } else if (place.kind === "page") {
    newSession.set(null)
    page.set(place.id)
  } else {
    page.set(null)
    newSession.set(place.start)
  }
  navState.set({ entries: state.entries, at: to })
  // After the stores' own cascades have run, so they are not recorded as a new visit.
  queueMicrotask(() => {
    traversing = false
  })
}
