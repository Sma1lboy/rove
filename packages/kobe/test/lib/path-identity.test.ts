import { pathIdentity, pathWithin, samePath } from "@sma1lboy/kobe-daemon/path-identity"
import { expect, it } from "vitest"

it.each([
  ["C:\\repo\\", "c:/repo"],
  ["C:\\repo\\src\\..", "C:/repo"],
  ["\\\\server\\share\\repo\\", "//server/share/repo"],
  ["C:\\", "c:/"],
  ["C://repo", "C:/repo"],
  ["\\\\?\\C:\\repo", "C:/repo"],
  ["\\\\?\\UNC\\server\\share\\repo", "//server/share/repo"],
  ["/repo/", "/repo"],
])("normalizes equivalent paths %s and %s idempotently", (left, right) => {
  expect(samePath(left, right)).toBe(true)
  expect(pathIdentity(pathIdentity(left))).toBe(pathIdentity(left))
})

it.each([
  ["C:/repo", "D:/repo"],
  ["C:/repo/A", "C:/repo/a"],
  ["/repo/a\\b", "/repo/a/b"],
  ["/repo/A", "/repo/a"],
  ["C:repo", "C:/repo"],
  ["", ""],
])("keeps distinct paths %s and %s apart", (left, right) => {
  expect(samePath(left, right)).toBe(false)
})

it.each([
  ["C:/", "C:\\repo", "repo"],
  ["/", "/repo", "repo"],
  ["C:/repo", "C:\\repo\\src", "src"],
  ["C:/repo", "C:/repo/..cache", "..cache"],
  ["C:/repo", "C:/repo/../other", null],
  ["C:/repo", "C:/repo-other", null],
  ["C:/repo", "D:/repo/src", null],
  ["//server/share/", "\\\\server\\share\\repo", "repo"],
  ["//server/share", "//server/share-other/repo", null],
])("checks segment ancestry %s -> %s", (parent, candidate, expected) => {
  expect(pathWithin(parent, candidate)).toBe(expected)
})

it("preserves opaque remote repo keys", () => {
  const key = "ssh://Host/work/Repo"
  expect(pathIdentity(key)).toBe(key)
  expect(samePath(key, "ssh://host/work/Repo")).toBe(false)
})
