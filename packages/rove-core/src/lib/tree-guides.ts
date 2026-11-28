/**
 * The indent columns of a child row in a task tree, as Claude's session tree draws them. Shared by
 * the web's rail and the terminal's task list, so both hang children the same way.
 */

/** One indent column: a line passing by, nothing, a line on to the next sibling, or the last sibling's hook. */
export type TreeGuide = "pipe" | "blank" | "tee" | "elbow"

/**
 * The columns of the row at `i`, outermost first; empty for a top-level row (depth 1 or less).
 * `depthAt` reads a row's depth, `count` is how many rows there are.
 */
export function treeGuides(count: number, depthAt: (index: number) => number, i: number): TreeGuide[] {
  const depth = depthAt(i)
  const guides: TreeGuide[] = []
  for (let d = 2; d <= depth; d++) {
    // The row at level `d` on this row's path has a later sibling: the first row after it at or above `d` sits at `d`.
    let j = i + 1
    while (j < count && depthAt(j) > d) j++
    const more = j < count && depthAt(j) === d
    guides.push(d === depth ? (more ? "tee" : "elbow") : more ? "pipe" : "blank")
  }
  return guides
}
