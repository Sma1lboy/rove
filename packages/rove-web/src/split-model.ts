/**
 * A tab's split panes as the page lays them out. The tree itself belongs to the
 * server (`tab.split` edits it, `task.tabs` reports it); here are the reads: panes
 * in reading order, where each sits, what it is called, which one is next.
 */

import type { SplitNodeView, SplitView, TabRow } from "rove-bridge/protocol"

export interface LeafView {
  readonly id: string
  readonly title: string | null
  readonly own: boolean
}

/** DFS order = the visual reading order; focus cycling follows it. */
export function leavesOf(node: SplitNodeView): readonly LeafView[] {
  return node.kind === "leaf" ? [node] : node.children.flatMap(leavesOf)
}

/** More than one pane; a lone surviving shell is not split (TUI `isTabSplit`). */
export function isSplit(split: SplitView | undefined | null): boolean {
  return !!split && leavesOf(split.root).length > 1
}

export interface LeafBox {
  readonly id: string
  /** Fractions of the tab body. */
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  /** The edges this pane shares with a previous sibling, drawn as dividers (TUI `line` style). */
  readonly left: boolean
  readonly top: boolean
}

/** Even split at every level (`flexGrow=1, flexBasis=0`). Flat, so a pane never remounts when a sibling is added around it. */
export function layoutSplit(root: SplitNodeView): readonly LeafBox[] {
  const out: LeafBox[] = []
  const place = (node: SplitNodeView, x: number, y: number, w: number, h: number, left: boolean, top: boolean) => {
    if (node.kind === "leaf") {
      out.push({ id: node.id, x, y, w, h, left, top })
      return
    }
    const n = node.children.length
    node.children.forEach((child, i) => {
      if (node.orientation === "row") place(child, x + (w * i) / n, y, w / n, h, i > 0 || left, top)
      else place(child, x, y + (h * i) / n, w, h / n, left, i > 0 || top)
    })
  }
  place(root, 0, 0, 1, 1, false, false)
  return out
}

/** The pane after `from` in reading order, wrapping (tmux `prefix o`, F3). */
export function cycleLeaf(split: SplitView, from: string, delta: 1 | -1 = 1): string {
  const order = leavesOf(split.root).map((leaf) => leaf.id)
  const at = order.indexOf(from)
  return order[(Math.max(0, at) + delta + order.length) % order.length] ?? from
}

/**
 * Pane names: a manual title wins; otherwise the tab's own pane shows the tab's label and a
 * shell pane "shell"; duplicate defaults get a reading-order suffix ("shell", "shell 2").
 */
export function leafNames(split: SplitView, tabLabel: string): ReadonlyMap<string, string> {
  const seen = new Map<string, number>()
  const names = new Map<string, string>()
  for (const leaf of leavesOf(split.root)) {
    if (leaf.title) {
      names.set(leaf.id, leaf.title)
      continue
    }
    const base = leaf.own ? tabLabel : "shell"
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    names.set(leaf.id, n === 1 ? base : `${base} ${n}`)
  }
  return names
}

/** The pane a tab's engine runs in: the tab's own pane, on an engine tab. A shell tab's own pane is just a shell. */
export function hostsEngine(tab: TabRow, split: SplitView, leaf: string): boolean {
  return tab.kind === "engine" && leavesOf(split.root).some((l) => l.id === leaf && l.own)
}

/** A tab with something running to split: its own session, or split shells once its own pane was closed (the daemon then reports the tab itself dead). */
export function hasLivePane(tab: TabRow): boolean {
  return tab.alive !== false || (!!tab.split && !leavesOf(tab.split.root).some((l) => l.own))
}

/** Identity of the pane set: the local focus resets when it changes (the TUI re-seeds on a new tree). */
export function leafSignature(split: SplitView): string {
  return leavesOf(split.root)
    .map((leaf) => leaf.id)
    .join(",")
}
