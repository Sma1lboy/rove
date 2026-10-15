/**
 * Host-level UI state: the one open overlay (menu or dialog) and transient toasts.
 */

import type { ReactNode } from "react"
import { createStore } from "./store.ts"

export interface MenuItem {
  readonly label: string
  readonly danger?: boolean
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
