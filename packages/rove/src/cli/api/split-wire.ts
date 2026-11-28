/**
 * A tab's split layout as `get-task` and `tab-split` report it. The persisted
 * tree carries each split shell's argv; clients get the shape and the names
 * only, so no client ever holds (or hands back) a command line.
 */

import type { SplitNode } from "../../tabs/split-core.ts"
import type { PersistedSplit } from "../../tabs/terminal-tab-split.ts"

export type WireSplitNode =
  /**
   * `own`: the tab's own process (`leaf-1`: its engine or shell), not a split shell. `liveVendor`
   * (split shells, `get-task` only): the engine a process walk found running in that pane now,
   * null = walked and none; absent = not walked.
   */
  | {
      readonly kind: "leaf"
      readonly id: string
      readonly title: string | null
      readonly own: boolean
      readonly liveVendor?: string | null
    }
  | { readonly kind: "group"; readonly orientation: "row" | "column"; readonly children: readonly WireSplitNode[] }

export interface WireSplit {
  readonly root: WireSplitNode
  readonly activeLeafId: string
}

type LeafVendor = (leafId: string) => string | null | undefined

function wireNode(node: SplitNode<readonly string[] | null>, vendorOf?: LeafVendor): WireSplitNode {
  if (node.kind === "leaf") {
    const own = node.content === null
    const liveVendor = own ? undefined : vendorOf?.(node.id)
    return {
      kind: "leaf",
      id: node.id,
      title: node.title ?? null,
      own,
      ...(liveVendor !== undefined ? { liveVendor } : {}),
    }
  }
  return { kind: "group", orientation: node.orientation, children: node.children.map((c) => wireNode(c, vendorOf)) }
}

export function wireSplit(tree: PersistedSplit | null | undefined, vendorOf?: LeafVendor): WireSplit | null {
  return tree ? { root: wireNode(tree.root, vendorOf), activeLeafId: tree.activeLeafId } : null
}
