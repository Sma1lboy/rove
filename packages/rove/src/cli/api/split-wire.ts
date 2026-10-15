/**
 * A tab's split layout as `get-task` and `tab-split` report it. The persisted
 * tree carries each split shell's argv; clients get the shape and the names
 * only, so no client ever holds (or hands back) a command line.
 */

import type { SplitNode } from "../../tui/workspace/split-core.ts"
import type { PersistedSplit } from "../../tui/workspace/terminal-tab-split.ts"

export type WireSplitNode =
  /** `own`: the tab's own process (`leaf-1`: its engine or shell), not a split shell. */
  | { readonly kind: "leaf"; readonly id: string; readonly title: string | null; readonly own: boolean }
  | { readonly kind: "group"; readonly orientation: "row" | "column"; readonly children: readonly WireSplitNode[] }

export interface WireSplit {
  readonly root: WireSplitNode
  readonly activeLeafId: string
}

function wireNode(node: SplitNode<readonly string[] | null>): WireSplitNode {
  if (node.kind === "leaf") return { kind: "leaf", id: node.id, title: node.title ?? null, own: node.content === null }
  return { kind: "group", orientation: node.orientation, children: node.children.map(wireNode) }
}

export function wireSplit(tree: PersistedSplit | null | undefined): WireSplit | null {
  return tree ? { root: wireNode(tree.root), activeLeafId: tree.activeLeafId } : null
}
