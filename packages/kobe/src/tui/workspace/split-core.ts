/**
 * Pure, content-agnostic tmux-style split tree for one workspace surface.
 * Leaves carry an opaque `content`; groups lay out `row` (side-by-side,
 * tmux `%`) or `column` (stacked, tmux `"`). Same-orientation splits insert
 * a sibling, cross-orientation splits nest a group.
 *
 * Framework-free so vitest can pin the transitions. Nothing here may know
 * about terminals, PTYs, or engines — content keying (e.g. `splitLeafPtyKey`)
 * lives with the adapter.
 */

export interface SplitLeaf<T> {
  readonly kind: "leaf"
  /** Stable id adapters key resources off; never reused within a tree. The
   *  first leaf is always `leaf-1`. */
  readonly id: string
  /** Opaque payload, owned by the adapter. */
  readonly content: T
  /** User-set name; absent/null = the adapter's default. */
  readonly title?: string | null
}

export interface SplitGroup<T> {
  readonly kind: "group"
  /** `row` = children side-by-side; `column` = children stacked. */
  readonly orientation: "row" | "column"
  /** Invariant: length ≥ 2 — transitions collapse 1-child groups away. */
  readonly children: readonly SplitNode<T>[]
}

export type SplitNode<T> = SplitLeaf<T> | SplitGroup<T>

export interface SplitState<T> {
  readonly root: SplitNode<T>
  /** The leaf that has keyboard focus while the surface is focused. */
  readonly activeLeafId: string
  /** Next leaf ordinal to hand out (monotonic — close does not recycle). */
  readonly nextOrdinal: number
}

/** Nesting-depth cap used only without a rendered size (tests, headless);
 *  otherwise `splitFits` decides. */
export const MAX_SPLIT_DEPTH = 4

/** Minimum pane size in cells; smaller predicted splits are rejected. Cols
 *  matches `use-terminal-geometry`'s render clamp; rows sits above its 4-row
 *  clamp so a pane never renders pinned at the degenerate minimum. */
export const MIN_PANE_COLS = 20
export const MIN_PANE_ROWS = 6

function depth<T>(node: SplitNode<T>): number {
  return node.kind === "leaf" ? 0 : 1 + Math.max(...node.children.map(depth))
}

/** Active leaf's direct-sibling count in a same-orientation group (else 1,
 *  it nests) — must mirror `splitActive`'s insert rule. */
function siblingCount<T>(root: SplitNode<T>, id: string, orientation: "row" | "column"): number {
  const find = (node: SplitNode<T>): number | null => {
    if (node.kind === "leaf") return null
    if (node.orientation === orientation && node.children.some((c) => c.kind === "leaf" && c.id === id)) {
      return node.children.length
    }
    for (const child of node.children) {
      const n = find(child)
      if (n !== null) return n
    }
    return null
  }
  return find(root) ?? 1
}

/**
 * Whether splitting keeps every pane ≥ `MIN_PANE_COLS`×`MIN_PANE_ROWS`,
 * from the active leaf's current size. Even-flex prediction (children are
 * `flexGrow=1 flexBasis=0`): a sibling insert divides ≈ n × the leaf's
 * extent among n+1; a nest halves it; one cell goes to the divider. Siblings
 * shrink to the same extent, so this covers them too.
 */
export function splitFits<T>(
  state: SplitState<T>,
  orientation: "row" | "column",
  activeSize: { cols: number; rows: number },
): boolean {
  const extent = orientation === "row" ? activeSize.cols : activeSize.rows
  const min = orientation === "row" ? MIN_PANE_COLS : MIN_PANE_ROWS
  const n = siblingCount(state.root, state.activeLeafId, orientation)
  return Math.floor((extent * n) / (n + 1)) - 1 >= min
}

/** The initial state: a single leaf (`leaf-1`) showing `content`. */
export function initialSplit<T>(content: T): SplitState<T> {
  return { root: { kind: "leaf", id: "leaf-1", content }, activeLeafId: "leaf-1", nextOrdinal: 2 }
}

/** DFS leaf order — the visual reading order (focus cycling follows it). */
export function leaves<T>(node: SplitNode<T>): readonly SplitLeaf<T>[] {
  return node.kind === "leaf" ? [node] : node.children.flatMap(leaves)
}

/**
 * Insert a leaf after the active one and focus it (as tmux does). No-op when
 * `splitFits` rejects `activeSize`, or, without a size, past `MAX_SPLIT_DEPTH`.
 */
export function splitActive<T>(
  state: SplitState<T>,
  orientation: "row" | "column",
  content: T,
  activeSize?: { cols: number; rows: number } | null,
): SplitState<T> {
  if (activeSize && !splitFits(state, orientation, activeSize)) return state
  const leaf: SplitLeaf<T> = { kind: "leaf", id: `leaf-${state.nextOrdinal}`, content }
  const insert = (node: SplitNode<T>): SplitNode<T> => {
    if (node.kind === "leaf") {
      if (node.id !== state.activeLeafId) return node
      return { kind: "group", orientation, children: [node, leaf] }
    }
    if (node.orientation === orientation) {
      const i = node.children.findIndex((c) => c.kind === "leaf" && c.id === state.activeLeafId)
      if (i >= 0) {
        const children = [...node.children.slice(0, i + 1), leaf, ...node.children.slice(i + 1)]
        return { ...node, children }
      }
    }
    return { ...node, children: node.children.map(insert) }
  }
  const root = insert(state.root)
  if (!activeSize && depth(root) > MAX_SPLIT_DEPTH) return state
  return { root, activeLeafId: leaf.id, nextOrdinal: state.nextOrdinal + 1 }
}

/**
 * Remove a leaf, collapsing 1-child groups. `null` when it's the last leaf —
 * the caller decides what then. Focus on the removed leaf moves to the
 * previous leaf in reading order (the next, if it was first).
 */
export function removeLeaf<T>(state: SplitState<T>, id: string): SplitState<T> | null {
  const all = leaves(state.root)
  if (all.length <= 1) return null
  const prune = (node: SplitNode<T>): SplitNode<T> | null => {
    if (node.kind === "leaf") return node.id === id ? null : node
    const children = node.children.map(prune).filter((c): c is SplitNode<T> => c !== null)
    if (children.length === 0) return null
    if (children.length === 1) return children[0]
    return { ...node, children }
  }
  const root = prune(state.root)
  if (root === null) return null // unreachable behind the length guard; keeps prune's type honest
  if (leaves(root).length === all.length) return state // id not present — no-op
  const order = all.map((l) => l.id)
  // `order` is pre-removal; the length guard guarantees index 1 exists.
  const removedIdx = order.indexOf(id)
  const fallback = order[removedIdx > 0 ? removedIdx - 1 : removedIdx + 1]
  const activeLeafId = state.activeLeafId === id ? fallback : state.activeLeafId
  return { ...state, root, activeLeafId }
}

/** Rename a leaf; blank clears to the default (as `renameActiveTab`). Unknown ids no-op. */
export function renameLeaf<T>(state: SplitState<T>, id: string, title: string): SplitState<T> {
  const trimmed = title.trim()
  const next = trimmed.length > 0 ? trimmed : null
  const walk = (node: SplitNode<T>): SplitNode<T> =>
    node.kind === "leaf"
      ? node.id === id
        ? { ...node, title: next }
        : node
      : { ...node, children: node.children.map(walk) }
  if (!leaves(state.root).some((l) => l.id === id)) return state
  return { ...state, root: walk(state.root) }
}

/** Cycle leaf focus by ±1 in reading order, wrapping (tmux `prefix o`). */
export function cycleLeaf<T>(state: SplitState<T>, delta: 1 | -1): SplitState<T> {
  const order = leaves(state.root).map((l) => l.id)
  if (order.length <= 1) return state
  const i = order.indexOf(state.activeLeafId)
  const next = order[(i + delta + order.length) % order.length]
  return { ...state, activeLeafId: next }
}

/** Focus a specific leaf (mouse click). No-op for unknown ids. */
export function focusLeaf<T>(state: SplitState<T>, id: string): SplitState<T> {
  if (!leaves(state.root).some((l) => l.id === id)) return state
  return state.activeLeafId === id ? state : { ...state, activeLeafId: id }
}
