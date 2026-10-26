/** Pane focus cycle, sidebar ← workspace → files (TUI `focus.next` / `focus.previous`): clamps at the ends, no wrap. */

import { type CyclePaneId, nextFocusedPane } from "@sma1lboy/rove/src/tui-react/workspace/keybinding-gates.ts"

/** pane → [its element, what takes focus in it]. */
const PANES: Record<CyclePaneId, readonly [string, string]> = {
  sidebar: [".rail", ".rail"],
  workspace: [".workspace", ".term-slot:not(.is-hidden) .split-leaf.is-active textarea"],
  files: [".side-panel", ".side-view:not([hidden]) :is([tabindex='0'], input)"],
}

export function focusPane(delta: 1 | -1): void {
  const order = Object.keys(PANES) as CyclePaneId[]
  const current = order.find((pane) => document.activeElement?.closest(PANES[pane][0])) ?? "sidebar"
  const next = nextFocusedPane(current, delta, { filesVisible: document.querySelector(PANES.files[0]) !== null })
  if (next) document.querySelector<HTMLElement>(PANES[next][1])?.focus()
}
