/**
 * Pure row model for the file tree pane, kept out of `FileTree.tsx` so
 * vitest/node can load it (no `@opentui`).
 *
 * {@link reconcileRows} is load-bearing: every fs-watch refresh rebuilds all
 * row objects, list rendering keys by identity, and @opentui/core 0.2.4
 * leaks ~300B native memory per renderable create/destroy (RSS climbs, JS
 * heap flat) — thousands of refreshes a day reach multi-GB. Reusing
 * unchanged rows limits churn to rows that actually changed.
 */

import { charWidth } from "@/lib/display-width"
import { reconcileStableRows } from "@/tui/lib/stable-rows"
import { truncateStartCells } from "@/tui/lib/truncate"
import type { FileStatus, StatusEntry } from "./git"
import type { TreeNode } from "./tree"

/** All tab: file/dir tree rows with `depth`. Changes tab: flat status rows with +/- stats. */
export type Row =
  | { kind: "file"; path: string; name: string; depth: number }
  | { kind: "dir"; path: string; name: string; depth: number; expanded: boolean; hasChildren: boolean }
  | {
      kind: "status"
      path: string
      status: FileStatus
      added: number | null | undefined
      deleted: number | null | undefined
      /** Untracked-directory rows only: file count + expansion state. */
      fileCount?: number
      expanded?: boolean
      /** True for a file row emitted under an expanded untracked dir. */
      child?: boolean
    }

/** Flatten the visible portion of a built tree into render rows. */
export function flattenTree(node: TreeNode, expanded: ReadonlySet<string>, depth: number, out: Row[]): void {
  for (const child of node.children) {
    if (child.isDir) {
      const isOpen = expanded.has(child.path)
      out.push({
        kind: "dir",
        path: child.path,
        name: child.name,
        depth,
        expanded: isOpen,
        hasChildren: child.children.length > 0,
      })
      if (isOpen) flattenTree(child, expanded, depth + 1, out)
    } else {
      out.push({ kind: "file", path: child.path, name: child.name, depth })
    }
  }
}

/**
 * Truncate keeping the TAIL (`…sidebar/Sidebar.tsx`) — the filename carries
 * the meaning. Via {@link truncateStartCells}, which never splits a
 * surrogate pair.
 *
 * `maxCells` is a CELL budget: the row has a hard right edge (status glyph,
 * stat columns, border), and a CJK path spends 2 cells per glyph — counting
 * code points would draw it through the border.
 */
export function truncatePathTail(path: string, maxCells: number): string {
  return truncateStartCells(path, maxCells, charWidth)
}

const NO_EXPANSION: ReadonlySet<string> = new Set()

/** Changes-tab rows. An untracked dir (`children`) is one row with a file
 *  count; when `expanded`, its children follow as indented rows. */
export function statusRows(entries: readonly StatusEntry[], expanded: ReadonlySet<string> = NO_EXPANSION): Row[] {
  const out: Row[] = []
  for (const e of entries) {
    if (e.children == null) {
      out.push({ kind: "status", path: e.path, status: e.status, added: e.added, deleted: e.deleted })
      continue
    }
    const isOpen = expanded.has(e.path)
    out.push({
      kind: "status",
      path: e.path,
      status: e.status,
      added: e.added,
      deleted: e.deleted,
      fileCount: e.children.length,
      expanded: isOpen,
    })
    if (isOpen) {
      for (const c of e.children) {
        out.push({ kind: "status", path: c.path, status: c.status, added: c.added, deleted: c.deleted, child: true })
      }
    }
  }
  return out
}

/** Identity key for a row — kind + path is unique within one tab's list. */
function rowKey(row: Row): string {
  return `${row.kind}\u0000${row.path}`
}

/** Field-level equality between two rows of the same key. */
function rowEquals(a: Row, b: Row): boolean {
  if (a.kind !== b.kind || a.path !== b.path) return false
  switch (a.kind) {
    case "file": {
      const o = b as Extract<Row, { kind: "file" }>
      return a.name === o.name && a.depth === o.depth
    }
    case "dir": {
      const o = b as Extract<Row, { kind: "dir" }>
      return a.name === o.name && a.depth === o.depth && a.expanded === o.expanded && a.hasChildren === o.hasChildren
    }
    case "status": {
      const o = b as Extract<Row, { kind: "status" }>
      return (
        a.status === o.status &&
        a.added === o.added &&
        a.deleted === o.deleted &&
        a.fileCount === o.fileCount &&
        a.expanded === o.expanded &&
        a.child === o.child
      )
    }
  }
}

/** Keep `prev` objects for unchanged rows; return the `prev` ARRAY itself
 *  when nothing moved, so a holding memo doesn't notify. */
export function reconcileRows(prev: readonly Row[], next: readonly Row[]): readonly Row[] {
  return reconcileStableRows(prev, next, rowKey, rowEquals)
}

/** Content equality for `allFiles`, so an mtime-only touch doesn't rebuild
 *  the tree. Null = "not loaded", equal only to itself. */
export function sameFileList(a: string[] | null, b: string[] | null): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/** Content equality for `changes`, including one level of untracked-dir
 *  `children` (changes inside a collapsed dir must still notify). */
export function sameStatusEntries(a: StatusEntry[] | null, b: StatusEntry[] | null): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as StatusEntry
    const y = b[i] as StatusEntry
    if (x.path !== y.path || x.status !== y.status || x.added !== y.added || x.deleted !== y.deleted) return false
    const xc = x.children
    const yc = y.children
    if ((xc == null) !== (yc == null)) return false
    if (xc && yc) {
      if (xc.length !== yc.length) return false
      for (let j = 0; j < xc.length; j++) {
        const cx = xc[j] as StatusEntry
        const cy = yc[j] as StatusEntry
        if (cx.path !== cy.path || cx.status !== cy.status || cx.added !== cy.added || cx.deleted !== cy.deleted)
          return false
      }
    }
  }
  return true
}
