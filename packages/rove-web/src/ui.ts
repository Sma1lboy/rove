/**
 * Host-level UI state: the one open overlay (menu or dialog) and transient toasts.
 */

import type { ReactNode } from "react"
import { createStore } from "./store.ts"

export interface MenuItem {
  readonly label: string
  readonly danger?: boolean
  /** The rail key that runs the same entry (TUI menus mirror a chord): shown as a hint, looked up by `rail-keys.ts`. */
  readonly key?: string
  readonly run: () => void
}

export interface MenuState {
  readonly x: number
  readonly y: number
  readonly items: readonly MenuItem[]
}

export interface Toast {
  readonly id: number
  readonly text: string
  readonly tone: "info" | "error"
}

export const menu = createStore<MenuState | null>(null)
/** At most one dialog, like the TUI's modal stack in practice. */
export const dialog = createStore<ReactNode | null>(null)
export const toasts = createStore<readonly Toast[]>([])

/** A read-only file or diff open over the workspace (the TUI's content tab). `path` `.` = whole worktree. */
export interface Preview {
  readonly taskId: string
  readonly path: string
  readonly scope: "working" | "branch"
}

export const preview = createStore<Preview | null>(null)
/** A full page over the workspace (TUI rail pages); `q`/Esc closes it. */
export const page = createStore<"worktrees" | null>(null)
/** The terminal stream this page has attached (`task::tab`); Files `a` pastes into it. */
export const activeStream = createStore<string | null>(null)
/** Zen hides the Files pane (TUI prefix z); persisted like the TUI's KV. */
export const zen = createStore<boolean>(localStorage.getItem("rove.web.zen") === "1")
zen.subscribe(() => localStorage.setItem("rove.web.zen", zen.get() ? "1" : "0"))

let nextToast = 1
const TOAST_MS = 4000

export function toast(text: string, tone: Toast["tone"] = "info"): void {
  const id = nextToast++
  toasts.set([...toasts.get(), { id, text, tone }])
  window.setTimeout(() => toasts.set(toasts.get().filter((t) => t.id !== id)), TOAST_MS)
}

export function closeDialog(): void {
  dialog.set(null)
}
