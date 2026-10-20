/**
 * Keyboard focus on the Mods page (TUI and web): every control — button or
 * input — across every open pane, in reading order. The cursor is a control
 * REF, not an index, because a mod redraws whenever it likes — an index would
 * jump to another control when one is added above it.
 */

import type { ModNode, ModPaneView } from "@sma1lboy/rove-daemon/plugins/mod-tree"

// The web reaches the tree contract through this file, as it does the TUI's other cores.
export { type ModNode, type ModPaneView, type ModTone, parseModUiPayload } from "@sma1lboy/rove-daemon/plugins/mod-tree"

export interface ModControlRef {
  readonly kind: "button" | "input"
  readonly plugin: string
  readonly pane: string
  readonly key: string
}

export function modControls(panes: readonly ModPaneView[]): ModControlRef[] {
  const out: ModControlRef[] = []
  const walk = (node: ModNode, plugin: string, pane: string): void => {
    if (node.type === "button" || node.type === "input") out.push({ kind: node.type, plugin, pane, key: node.key })
    else if (node.type === "box") for (const child of node.children) walk(child, plugin, pane)
  }
  for (const pane of panes) walk(pane.tree, pane.plugin, pane.id)
  return out
}

export function sameModControl(a: ModControlRef | null, b: ModControlRef | null): boolean {
  return a !== null && b !== null && a.plugin === b.plugin && a.pane === b.pane && a.key === b.key
}

/** The focused control after a redraw: still there, else the first one. */
export function resolveModCursor(
  controls: readonly ModControlRef[],
  cursor: ModControlRef | null,
): ModControlRef | null {
  return controls.find((c) => sameModControl(c, cursor)) ?? controls[0] ?? null
}

/** Step the cursor, wrapping at both ends. */
export function moveModCursor(
  controls: readonly ModControlRef[],
  cursor: ModControlRef | null,
  delta: -1 | 1,
): ModControlRef | null {
  if (controls.length === 0) return null
  const at = controls.findIndex((c) => sameModControl(c, cursor))
  if (at < 0) return controls[0] ?? null
  return controls[(at + delta + controls.length) % controls.length] ?? null
}
