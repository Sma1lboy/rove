/**
 * Host-level UI state: the one open overlay (menu or dialog) and transient toasts.
 */

import type { ReactNode } from "react"
import { createStore } from "./store.ts"

export interface MenuItem {
  readonly label: string
  readonly danger?: boolean
  /** The chord that runs the same entry (TUI menus mirror it), as the keymap spells it now: shown as a hint. */
  readonly key?: string
  /** The TUI binding id whose rail key runs this entry: `rail-keys.ts` looks the entry up by it. */
  readonly binding?: string
  /** Entries sharing a section sit together; a divider falls where the section changes (claude.ai's grouped menus). */
  readonly section?: string
  /** A choice list one level down, opened to the side (`Set status ›`, `Copy ›`). An entry has this or `run`. */
  readonly children?: readonly MenuItem[]
  /** The current pick in a choice list: drawn with a check. */
  readonly checked?: boolean
  readonly run?: () => void
}

/** The entry a rail key runs, wherever it sits in the menu tree. */
export function findBinding(items: readonly MenuItem[], binding: string): MenuItem | undefined {
  for (const item of items) {
    if (item.binding === binding) return item
    const inner = item.children && findBinding(item.children, binding)
    if (inner) return inner
  }
  return undefined
}

export interface MenuState {
  readonly x: number
  readonly y: number
  readonly items: readonly MenuItem[]
  /** The element right-clicked: it reads as hovered (`data-menu-open`) while its menu is up. */
  readonly target?: Element
  /** Opened from the keyboard (Shift+F10, the menu key): the first entry starts highlighted, as in a native menu. */
  readonly fromKeyboard?: boolean
}

export interface Toast {
  readonly id: number
  readonly text: string
  readonly tone: "info" | "error"
}

export const menu = createStore<MenuState | null>(null)
/** At most one dialog, like the TUI's modal stack in practice. */
export const dialog = createStore<ReactNode | null>(null)

/** Closing a dialog hands the keyboard back to where it was opened from (the TUI's dialog stack), read before the dialog's own field takes focus. */
let dialogOrigin: HTMLElement | null = null
dialog.subscribe(() => {
  const active = document.activeElement
  if (dialog.get() !== null) {
    if (!dialogOrigin && active instanceof HTMLElement && !active.closest(".dialog")) dialogOrigin = active
    return
  }
  const origin = dialogOrigin
  dialogOrigin = null
  window.setTimeout(() => {
    if (origin?.isConnected && (!document.activeElement || document.activeElement === document.body)) origin.focus()
  }, 0)
})
export const toasts = createStore<readonly Toast[]>([])

/** A read-only file or diff open over the workspace (the TUI's content tab). `path` `.` = whole worktree. */
export interface Preview {
  readonly taskId: string
  readonly path: string
  readonly scope: "working" | "branch"
}

export const preview = createStore<Preview | null>(null)
export type PageId = "worktrees" | "update" | "kanban" | "routines" | "issues" | "mods"
/** A full page over the workspace (TUI rail pages); `q`/Esc closes it. */
export const page = createStore<PageId | null>(null)
/** The routine the Inbox sent the Routines page to; the page puts its cursor there once and clears this. */
export const routineFocus = createStore<string | null>(null)
/** The terminal stream this page has attached (`task::tab`); Files `a` pastes into it. */
export const activeStream = createStore<string | null>(null)
/** Zen hides the Files pane (TUI prefix z). `prefs-apply.ts` keeps it in step with the TUI's `zen.active`. */
export const zen = createStore<boolean>(false)

let nextToast = 1
const TOAST_MS = 4000
/** The TUI's overlay shows the newest three. */
const TOASTS_SHOWN = 3

export function toast(text: string, tone: Toast["tone"] = "info"): void {
  const id = nextToast++
  toasts.set([...toasts.get(), { id, text, tone }].slice(-TOASTS_SHOWN))
  window.setTimeout(() => dismissToast(id), TOAST_MS)
}

/** A click on the card, or its timer. */
export function dismissToast(id: number): void {
  toasts.set(toasts.get().filter((t) => t.id !== id))
}

export function closeDialog(): void {
  dialog.set(null)
}
