/** Directory-tree data structure for the file-tree pane.
 *
 * {@link buildTree} turns a flat list of file paths into a sorted, nested
 * {@link TreeNode} hierarchy. This is independent of git: the file list can
 * come from `git ls-files`, a static snapshot, or any other source. */

export type TreeNode = {
  /** Path segment (last component). Empty for the root. */
  name: string
  /** Full path relative to worktree root. Empty for the root. */
  path: string
  /** Directories vs leaves. Directories may have empty `children` if
   * a file under them is filtered out — but `buildTree` never produces
   * empty dirs since paths terminate at files. */
  isDir: boolean
  children: TreeNode[]
}

/**
 * Build a directory tree from a flat list of paths. Used by the All
 * tab to render files grouped by their on-disk hierarchy. The returned
 * root has an empty name/path; its children are the top-level entries
 * sorted with directories first, then files, alphabetically within each
 * group (matches VS Code / Finder default).
 */
export function buildTree(paths: readonly string[]): TreeNode {
  const root: TreeNode = { name: "", path: "", isDir: true, children: [] }
  for (const p of paths) {
    if (!p) continue
    const segs = p.split("/").filter((s) => s.length > 0)
    if (segs.length === 0) continue
    let cur = root
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i] as string
      const isLast = i === segs.length - 1
      const isDir = !isLast
      let child = cur.children.find((c) => c.name === seg && c.isDir === isDir)
      if (!child) {
        child = {
          name: seg,
          path: segs.slice(0, i + 1).join("/"),
          isDir,
          children: [],
        }
        cur.children.push(child)
      }
      cur = child
    }
  }
  sortTree(root)
  return root
}

function sortTree(node: TreeNode): void {
  node.children.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  for (const c of node.children) sortTree(c)
}
