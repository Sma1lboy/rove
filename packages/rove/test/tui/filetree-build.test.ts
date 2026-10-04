import { expect, it } from "vitest"
import { buildTree } from "../../src/tui/panes/filetree/tree.ts"

it("deduplicates paths while preserving same-name files and directories and sort order", () => {
  const paths = ["z", "same", "same/a", "/same//a/", "a", "", "/", "same/b", "other/c"]
  const root = buildTree(paths)
  expect(root.children.map(({ name, isDir }) => [name, isDir])).toEqual([
    ["other", true],
    ["same", true],
    ["a", false],
    ["same", false],
    ["z", false],
  ])
  expect(root.children[1]?.children.map(({ path }) => path)).toEqual(["same/a", "same/b"])
  expect(buildTree([...paths].reverse())).toEqual(root)
})

it("builds a wide directory with all unique leaves and stable sorted output", () => {
  const paths = Array.from({ length: 20000 }, (_, i) => `wide/file-${String(i).padStart(5, "0")}`)
  const tree = buildTree([...paths].reverse().concat(paths))
  expect(tree.children).toHaveLength(1)
  expect(tree.children[0]?.children.map((node) => node.path)).toEqual(paths)
})
