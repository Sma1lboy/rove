/** Flat worktree paths → the visible rows of a collapsible tree (TUI Files › All). */

import { compareFileEntries } from "@sma1lboy/rove/src/lib/file-order.ts"

export interface TreeRow {
  /** Directory paths end in `/`, the TUI's combined-pathspec spelling. */
  readonly path: string
  readonly name: string
  readonly depth: number
  readonly dir: boolean
  readonly open: boolean
}

interface Node {
  readonly children: Map<string, Node>
  file: boolean
}

export function visibleTree(files: readonly string[], expanded: ReadonlySet<string>): TreeRow[] {
  const root: Node = { children: new Map(), file: false }
  for (const file of files) {
    let node = root
    for (const part of file.split("/")) {
      let next = node.children.get(part)
      if (!next) {
        next = { children: new Map(), file: false }
        node.children.set(part, next)
      }
      node = next
    }
    node.file = true
  }
  const rows: TreeRow[] = []
  const walk = (node: Node, prefix: string, depth: number) => {
    const entries = [...node.children].sort(([a, x], [b, y]) =>
      compareFileEntries(
        { name: a, dir: x.children.size > 0 && !x.file },
        { name: b, dir: y.children.size > 0 && !y.file },
      ),
    )
    for (const [name, child] of entries) {
      const dir = child.children.size > 0 && !child.file
      const path = dir ? `${prefix}${name}/` : `${prefix}${name}`
      const open = dir && expanded.has(path)
      rows.push({ path, name, depth, dir, open })
      if (open) walk(child, path, depth + 1)
    }
  }
  walk(root, "", 0)
  return rows
}
