/** Pane focus cycle, sidebar ← workspace → files (TUI `focus.next` / `focus.previous`): clamps at the ends, no wrap. */

import { type CyclePaneId, nextFocusedPane } from "@sma1lboy/rove/src/tui-react/workspace/keybinding-gates.ts"

/** The terminal that has the keyboard when the workspace does: the active leaf of the shown tab (a parked terminal sits outside every leaf). */
const ACTIVE_TERMINAL = ".split-leaf.is-active textarea.xterm-helper-textarea"

/** pane → [its element, what takes focus in it]. */
const PANES: Record<CyclePaneId, readonly [string, string]> = {
  sidebar: [".rail", ".rail"],
  workspace: [".workspace", ACTIVE_TERMINAL],
  files: [".side-panel", ".side-view:not([hidden]) :is([tabindex='0'], input)"],
}

/** The active terminal's input when it is on screen (a phone showing the panel hides it), else null. */
export function shownTerminalInput(): HTMLTextAreaElement | null {
  for (const input of document.querySelectorAll<HTMLTextAreaElement>(ACTIVE_TERMINAL)) {
    if (input.closest("[data-stream]")?.getClientRects().length) return input
  }
  return null
}

/** Put the keyboard in the active terminal; false when none is on screen. */
export function focusActiveTerminal(): boolean {
  const input = shownTerminalInput()
  input?.focus()
  return input !== null
}

export function focusPane(delta: 1 | -1): void {
  const order = Object.keys(PANES) as CyclePaneId[]
  const current = order.find((pane) => document.activeElement?.closest(PANES[pane][0])) ?? "sidebar"
  const next = nextFocusedPane(current, delta, { filesVisible: document.querySelector(PANES.files[0]) !== null })
  if (next) document.querySelector<HTMLElement>(PANES[next][1])?.focus()
}
