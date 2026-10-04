/** Directory tree for the file-tree pane; git-independent. */

export type TreeNode = {
  /** Path segment (last component). Empty for the root. */
  name: string
  /** Full path relative to worktree root. Empty for the root. */
  path: string
  /** `buildTree` never yields empty dirs (paths end at files); filtering may. */
  isDir: boolean
  children: TreeNode[]
}

/** Nested tree from flat paths; root has empty name/path. Dirs first, then
 *  files, alphabetical within each (VS Code / Finder order). */
export function buildTree(paths: readonly string[]): TreeNode {
  const root: TreeNode = { name: "", path: "", isDir: true, children: [] }
  const indexes = new Map<TreeNode, Map<string, TreeNode>>()
  for (const p of paths) {
    if (!p) continue
    const segs = p.split("/").filter((s) => s.length > 0)
    if (segs.length === 0) continue
    let cur = root
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i] as string
      const isLast = i === segs.length - 1
      const isDir = !isLast
      let index = indexes.get(cur)
      if (!index) {
        index = new Map()
        indexes.set(cur, index)
      }
      const key = `${isDir ? "d" : "f"}:${seg}`
      let child = index.get(key)
      if (!child) {
        child = {
          name: seg,
          path: segs.slice(0, i + 1).join("/"),
          isDir,
          children: [],
        }
        cur.children.push(child)
        index.set(key, child)
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
