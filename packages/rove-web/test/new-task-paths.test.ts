import { describe, expect, test } from "bun:test"
import {
  cloneSource,
  deriveFolderName,
  expandTilde,
  filterByGlob,
  githubRepoName,
  isPathInput,
  joinDrill,
  joinPicked,
  nameOrPath,
  resolveRepo,
  splitRepoRow,
  stripTrailingSlash,
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

  test("a Windows drive path is a path, with either separator", () => {
    const home = "C:\\Users\\me"
    for (const path of ["C:\\Code\\app", "C:/Code/app", "c:\\", "~\\app", "\\\\host\\share\\app"]) {
      expect(isPathInput(path)).toBe(true)
    }
    expect(isPathInput("app")).toBe(false)
    expect(resolveRepo("C:\\Code\\app", saved)).toEqual({ kind: "path", path: "C:\\Code\\app" })
    expect(splitRepoRow("C:\\Code\\app")).toEqual({ base: "app", dir: "C:\\Code\\" })
    expect(splitRepoRow("C:/Code/app")).toEqual({ base: "app", dir: "C:/Code/" })
    expect(nameOrPath("C:/Code/app", ["C:/Code/app"])).toBe("app")
    expect(expandTilde("~\\app", home)).toBe("C:\\Users\\me\\app")
    expect(expandTilde("~/app", home)).toBe("C:\\Users\\me/app")
    expect(stripTrailingSlash("C:\\Code\\app\\")).toBe("C:\\Code\\app")
    expect(stripTrailingSlash("C:/Code/app//")).toBe("C:/Code/app")
    expect(stripTrailingSlash("C:\\")).toBe("C:\\")
    expect(stripTrailingSlash("/w/a/")).toBe("/w/a")
    expect(stripTrailingSlash("/")).toBe("/")
    expect(joinPicked("~/pro", "C:\\Users\\me/", "projects", home)).toBe("~/projects")
    expect(joinDrill("C:\\Co", "C:\\", "Code", home)).toBe("C:\\Code/")
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

describe("githubRepoName", () => {
  test("a GitHub URL of any shape and the shorthand name the same repo", () => {
    for (const text of [
      "https://github.com/starsrc/Bowl",
      "https://github.com/starsrc/Bowl/",
      "https://github.com/starsrc/Bowl.git",
      "https://github.com/starsrc/Bowl/pull/12",
      "git@github.com:starsrc/Bowl.git",
      " starsrc/Bowl ",
    ]) {
      expect(githubRepoName(text)).toBe("starsrc/bowl")
    }
  })

  test("a name, a path, another host and a bare owner name no repo", () => {
    for (const text of ["", "Bowl", "~/code/Bowl", "/w/a/b", "https://gitlab.com/o/r", "https://github.com/starsrc"]) {
      expect(githubRepoName(text)).toBeNull()
    }
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
