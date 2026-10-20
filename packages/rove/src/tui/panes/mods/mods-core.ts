/**
 * Keyboard focus on the Mods page (TUI and web): every button across every open pane, in
 * reading order. The cursor is a button REF, not an index, because a mod
 * redraws whenever it likes — an index would jump to another button when one
 * is added above it.
 */

import type { ModNode, ModPaneView } from "@sma1lboy/rove-daemon/plugins/mod-tree"

// The web reaches the tree contract through this file, as it does the TUI's other cores.
export { type ModNode, type ModPaneView, type ModTone, parseModUiPayload } from "@sma1lboy/rove-daemon/plugins/mod-tree"

export interface ModButtonRef {
  readonly plugin: string
  readonly pane: string
  readonly key: string
}

export function modButtons(panes: readonly ModPaneView[]): ModButtonRef[] {
  const out: ModButtonRef[] = []
  const walk = (node: ModNode, plugin: string, pane: string): void => {
    if (node.type === "button") out.push({ plugin, pane, key: node.key })
    else if (node.type === "box") for (const child of node.children) walk(child, plugin, pane)
  }
  for (const pane of panes) walk(pane.tree, pane.plugin, pane.id)
  return out
}

export function sameModButton(a: ModButtonRef | null, b: ModButtonRef | null): boolean {
  return a !== null && b !== null && a.plugin === b.plugin && a.pane === b.pane && a.key === b.key
}

/** The focused button after a redraw: still there, else the first one. */
export function resolveModCursor(buttons: readonly ModButtonRef[], cursor: ModButtonRef | null): ModButtonRef | null {
  return buttons.find((b) => sameModButton(b, cursor)) ?? buttons[0] ?? null
}

/** Step the cursor, wrapping at both ends. */
export function moveModCursor(
  buttons: readonly ModButtonRef[],
  cursor: ModButtonRef | null,
  delta: -1 | 1,
): ModButtonRef | null {
  if (buttons.length === 0) return null
  const at = buttons.findIndex((b) => sameModButton(b, cursor))
  if (at < 0) return buttons[0] ?? null
  return buttons[(at + delta + buttons.length) % buttons.length] ?? null
}
