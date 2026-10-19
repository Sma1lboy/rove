import { expect, test } from "vitest"
import { cachedFileList, rememberFileList } from "../../src/tui/panes/filetree/file-list-cache"

test("retains the last four listings for immediate paint and replaces a refreshed listing", () => {
  for (const path of ["a", "b", "c", "d"]) rememberFileList(path, [`${path}.txt`])
  rememberFileList("a", ["updated.txt"])
  rememberFileList("e", ["e.txt"])
  expect(cachedFileList("a")).toEqual(["updated.txt"])
  expect(cachedFileList("b")).toBeNull()
  expect(cachedFileList("c")).toEqual(["c.txt"])
  expect(cachedFileList("d")).toEqual(["d.txt"])
  expect(cachedFileList("e")).toEqual(["e.txt"])
})
