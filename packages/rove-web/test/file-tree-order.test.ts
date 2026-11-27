import { expect, test } from "bun:test"
import { visibleTree } from "../src/file-tree.ts"

test("the web Files tree uses the TUI's GitHub order: folders first, capitals before lowercase", () => {
  const rows = visibleTree(["package.json", "README.md", "src/a.ts", "d2", "d10"], new Set())
  expect(rows.map((row) => row.name)).toEqual(["src", "README.md", "d10", "d2", "package.json"])
})
