/**
 * Escape is the interrupt of every engine rove runs (Claude Code, Codex, Pi, omp: "esc to interrupt"), and
 * xterm sends it only while its own textarea has focus. A click on a top-bar icon or a panel's close button
 * leaves focus on that button, or on the page once the button is gone: the terminal's cursor goes hollow and
 * Escape reaches nobody, so the engine keeps running. An Escape that no pane, field or overlay took goes to
 * the terminal on screen instead.
 */

import { useEffect } from "react"
import { shownTerminalInput } from "./pane-focus.ts"
import { termFor } from "./term-control.ts"
import { dialog, menu, newSession, page } from "./ui.ts"

/** What holds focus, as far as Escape cares. */
export type FocusOwner =
  /** Nothing: the page itself, after the focused element went away. */
  | "none"
  /** A control outside every pane (the top bar): focus is incidental, left by a click. */
  | "loose"
  /** The terminal, which sends Escape itself. */
  | "terminal"
  /** A text field: Escape is its own (clear, cancel). */
  | "field"
  /** The rail, the side panel, a dialog or a menu: they read keys of their own. */
  | "pane"

export interface FocusProbe {
  readonly tagName: string
  readonly isContentEditable: boolean
  closest(selector: string): unknown
}

const FIELDS: Record<string, true> = { INPUT: true, TEXTAREA: true, SELECT: true }
const PANES = ".rail, .side-panel, dialog, [role=dialog], [role=menu], [role=listbox]"

export function focusOwner(el: FocusProbe | null): FocusOwner {
  if (!el || el.tagName === "BODY" || el.tagName === "HTML") return "none"
  // xterm's helper is a textarea too: it is the terminal, not a field.
  if (el.closest(".xterm")) return "terminal"
  if (FIELDS[el.tagName] === true || el.isContentEditable) return "field"
  return el.closest(PANES) ? "pane" : "loose"
}

export interface EscapePress {
  readonly key: string
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
  readonly isComposing: boolean
  /** Something earlier in the dispatch already took this key. */
  readonly defaultPrevented: boolean
}

export interface EscapeScene {
  /** A dialog, a menu or a full page is open: it owns Escape while it is. */
  readonly overlay: boolean
  /** The active terminal is on screen. */
  readonly terminal: boolean
}

/** A bare Escape that nothing took, with focus on no pane, goes to the terminal on screen. */
export function escapeGoesToTerminal(press: EscapePress, owner: FocusOwner, scene: EscapeScene): boolean {
  if (press.key !== "Escape" || press.defaultPrevented || press.isComposing) return false
  if (press.ctrlKey || press.metaKey || press.altKey || press.shiftKey) return false
  if (scene.overlay || !scene.terminal) return false
  return owner === "none" || owner === "loose"
}

/** Window-level, bubbling: every pane's and overlay's own Escape has already had its turn. */
export function useEscapeInterrupt(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      const input = shownTerminalInput()
      const el = document.activeElement
      const owner = focusOwner(el instanceof HTMLElement ? el : null)
      const overlay = dialog.get() !== null || menu.get() !== null || page.get() !== null || newSession.get() !== null
      if (!escapeGoesToTerminal(e, owner, { overlay, terminal: input !== null })) return
      const stream = input?.closest<HTMLElement>("[data-stream]")?.dataset.stream
      const control = stream ? termFor(stream) : undefined
      if (!input || !control) return
      e.preventDefault()
      input.focus()
      control.input("\x1b")
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
}
