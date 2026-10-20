/**
 * How one split pane is framed under each `SplitStyle`, as box props the
 * caller spreads (colours stay with the caller). `divider` is the edge the
 * pane shares with its previous sibling: `left` in a row, `top` in a column.
 * The rail/rule shapes follow oh-my-pi's composer styles (MIT).
 */

import type { BorderCharacters, BorderSides, RGBA } from "@opentui/core"
import type { SplitStyle } from "../../state/split-style"
import type { SplitNode } from "./split-core"

export type SplitDivider = "left" | "top"

export type PaneChrome = {
  readonly border: boolean | BorderSides[]
  readonly borderStyle?: "rounded"
  readonly customBorderChars?: BorderCharacters
  /** One blank cell toward the previous sibling, where two edges would otherwise fuse. */
  readonly marginLeft?: number
  readonly marginTop?: number
  /** The pane's name rides its top rule instead of the corner tag. */
  readonly nameOnRule: boolean
}

// Only `vertical` is drawn: the rail is a left edge alone.
const RAIL_CHARS: BorderCharacters = {
  topLeft: "▎",
  topRight: "▎",
  bottomLeft: "▎",
  bottomRight: "▎",
  horizontal: " ",
  vertical: "▎",
  topT: "▎",
  bottomT: "▎",
  leftT: "▎",
  rightT: "▎",
  cross: "▎",
}

export function paneChrome(style: SplitStyle, divider: SplitDivider | undefined): PaneChrome {
  switch (style) {
    case "box":
      return { border: true, borderStyle: "rounded", nameOnRule: false }
    case "line":
      return { border: divider ? [divider] : false, nameOnRule: false }
    case "rail":
      // Stacked rails would run into one bar.
      return {
        border: ["left"],
        customBorderChars: RAIL_CHARS,
        marginTop: divider === "top" ? 1 : 0,
        nameOnRule: false,
      }
    case "rule":
      // Side-by-side rules would run into one line.
      return { border: ["top"], marginLeft: divider === "left" ? 1 : 0, nameOnRule: true }
  }
}

/** A nested group: `line`'s divider, the other styles' sibling gap; its leaves carry the rest. */
export function groupChrome(style: SplitStyle, divider: SplitDivider | undefined): PaneChrome {
  if (style === "line") return paneChrome(style, divider)
  const { marginLeft, marginTop } = paneChrome(style, divider)
  return { border: false, marginLeft, marginTop, nameOnRule: false }
}

/**
 * Chrome as ready-to-spread box props. `borderColor` stays ABSENT on an
 * edgeless box: opentui coerces `border: false` to a full frame whenever any
 * border styling lands, even an undefined one.
 */
export function paneBoxProps(
  chrome: PaneChrome,
  ink: { readonly edge: RGBA; readonly name?: string; readonly nameInk?: RGBA },
) {
  const { nameOnRule, ...frame } = chrome
  return {
    ...frame,
    ...(frame.border === false ? {} : { borderColor: ink.edge }),
    ...(nameOnRule ? { title: ` ${ink.name ?? ""} `, titleAlignment: "right" as const, titleColor: ink.nameInk } : {}),
  }
}

/**
 * Whether leaf `id` sits on `node`'s start (`end` false) or end edge along a
 * parent's `orientation` — i.e. borders the `line` divider on that edge.
 */
export function leafOnEdge<T>(node: SplitNode<T>, orientation: "row" | "column", end: boolean, id: string): boolean {
  if (node.kind === "leaf") return node.id === id
  if (node.orientation !== orientation) return node.children.some((c) => leafOnEdge(c, orientation, end, id))
  const edge = end ? node.children[node.children.length - 1] : node.children[0]
  return edge !== undefined && leafOnEdge(edge, orientation, end, id)
}
