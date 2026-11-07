import { describe, expect, test } from "bun:test"
import {
  cloneSource,
  deriveFolderName,
  filterByGlob,
  joinDrill,
  joinPicked,
  nameOrPath,
  resolveRepo,
} from "../src/new-task-paths.ts"

describe("new-task dialog paths", () => {
  const saved = ["/w/a/app", "/w/b/app", "/w/b/lib"]

  test("a bare name resolves to its one saved path, refuses a shared basename, passes paths through", () => {
    expect(resolveRepo("lib", saved)).toEqual({ kind: "path", path: "/w/b/lib" })
    expect(resolveRepo("app", saved)).toEqual({ kind: "ambiguous", name: "app" })
    expect(resolveRepo("~/x", saved)).toEqual({ kind: "path", path: "~/x" })
    expect(resolveRepo("nope", saved)).toEqual({ kind: "path", path: "nope" })
  })

  test("the field shows a name only when it resolves back to the same path", () => {
    expect(nameOrPath("/w/b/lib", saved)).toBe("lib")
    expect(nameOrPath("/w/a/app", saved)).toBe("/w/a/app")
  })

  test("picking keeps a typed ~ prefix; drilling adds the slash", () => {
    expect(joinPicked("~/pro", "/home/me/", "projects", "/home/me")).toBe("~/projects")
    expect(joinDrill("~/pro", "/home/me/", "projects", "/home/me")).toBe("~/projects/")
    expect(joinPicked("/tm", "/", "tmp", "/home/me")).toBe("/tmp")
  })

  test("clone folder comes from the last URL segment", () => {
    expect(deriveFolderName("https://github.com/foo/bar.git")).toBe("bar")
    expect(deriveFolderName("git@github.com:foo/baz.git")).toBe("baz")
    expect(deriveFolderName("https://example.com/path/repo/")).toBe("repo")
  })

  test("the adopt glob matches the whole path or the basename", () => {
    const list = [{ path: "/x/feature-1" }, { path: "/x/fix-2" }]
    expect(filterByGlob(list, "feature-*")).toEqual([{ path: "/x/feature-1" }])
    expect(filterByGlob(list, "/x/*")).toHaveLength(2)
    expect(filterByGlob(list, "")).toHaveLength(2)
  })
})

describe("cloneSource", () => {
  test("git URLs and owner/repo shorthand are clone sources, trimmed", () => {
    for (const ok of [
      "octocat/Hello-World",
      " octocat/Hello-World ",
      "o/.github",
      "o/repo.git",
      "https://github.com/o/r.git",
      "ssh://git@host:22/o/r",
      "git@github.com:o/r.git",
    ]) {
      expect(cloneSource(ok)).toBe(ok.trim())
    }
  })

  test("paths, deeper paths, names and dot segments stay local", () => {
    for (const no of [
      "",
      "app",
      "/w/a",
      "~/w/a",
      "~/a/b",
      "./a/b",
      "../a",
      "a/b/c",
      "o/.",
      "o/..",
      "o/.git",
      "-o/x",
      "o/ x",
    ]) {
      expect(cloneSource(no)).toBeNull()
    }
  })
})
