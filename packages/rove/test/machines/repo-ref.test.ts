import { describe, expect, test } from "vitest"
import { cloneDirFor, findCheckouts, parseRepoRef, pickCheckout, repoIdOf } from "../../src/machines/repo-ref.ts"

const none = () => false

describe("parseRepoRef", () => {
  test("owner/name is a GitHub repo id", () => {
    expect(parseRepoRef("Sma1lboy/Rove", "/x", none)).toEqual({
      kind: "id",
      id: "github.com/sma1lboy/rove",
      cloneUrl: "https://github.com/sma1lboy/rove.git",
    })
  })

  test("host/owner/name and GitLab subgroups are ids", () => {
    expect(parseRepoRef("gitlab.com/group/sub/proj", "/x", none)).toMatchObject({
      kind: "id",
      id: "gitlab.com/group/sub/proj",
    })
  })

  test("remote URLs are ids, cloned from the URL as given", () => {
    expect(parseRepoRef("git@github.com:me/rove.git", "/x", none)).toEqual({
      kind: "id",
      id: "github.com/me/rove",
      cloneUrl: "git@github.com:me/rove.git",
    })
    expect(parseRepoRef("https://github.com/me/rove", "/x", none)).toMatchObject({ id: "github.com/me/rove" })
  })

  test("anything path-like stays a path", () => {
    for (const raw of ["/home/me/rove", "~/rove", "./rove", "../rove", "C:\\code\\rove", "C:/code/rove", "rove"]) {
      expect(parseRepoRef(raw, "/x", none)).toEqual({ kind: "path", path: raw })
    }
    expect(parseRepoRef("ssh://me@box/srv/rove", "/x", none).kind).toBe("path")
    expect(parseRepoRef("a/b/c", "/x", none).kind).toBe("path")
  })

  test("an existing relative directory beats the owner/name reading", () => {
    expect(parseRepoRef("me/rove", "/x", () => true)).toEqual({ kind: "path", path: "me/rove" })
  })
})

describe("repo ids", () => {
  test("origin, else root commit, else nothing", () => {
    expect(repoIdOf({ origin: "github.com/me/rove", root: "abc" })).toBe("github.com/me/rove")
    expect(repoIdOf({ root: "abc" })).toBe("root:abc")
    expect(repoIdOf({})).toBeNull()
    expect(repoIdOf(null)).toBeNull()
  })

  test("clone dir mirrors the id", () => {
    expect(cloneDirFor("github.com/me/rove", "/home/u").split(String.fromCharCode(92)).join("/")).toBe(
      "/home/u/.rove/repos/github.com/me/rove",
    )
  })
})

describe("choosing a checkout", () => {
  const want = { origin: "github.com/me/rove", root: "r1" }
  const candidates = [
    { path: "/a", identity: { origin: "github.com/me/rove", root: "r1" } },
    { path: "/fork", identity: { origin: "github.com/other/rove", root: "r1" } },
    { path: "/b", identity: { origin: "github.com/me/rove", root: "r1" } },
    { path: "/unrelated", identity: { origin: "github.com/me/else", root: "r9" } },
  ]

  test("a same-root checkout under another origin is a fork", () => {
    expect(findCheckouts(want, candidates)).toEqual([
      { path: "/a", via: "root", fork: false },
      { path: "/fork", via: "root", fork: true },
      { path: "/b", via: "root", fork: false },
    ])
  })

  test("primary, then clean, then first; forks only when allowed", () => {
    const matches = findCheckouts(want, candidates)
    expect(pickCheckout(matches, { primary: "/b" }).path).toBe("/b")
    expect(pickCheckout(matches, { isClean: (p) => p === "/b" }).path).toBe("/b")
    expect(pickCheckout(matches, {}).path).toBe("/a")
    const forkOnly = findCheckouts(want, [candidates[1] as (typeof candidates)[number]])
    expect(pickCheckout(forkOnly, {})).toEqual({ path: null, fork: "/fork" })
    expect(pickCheckout(forkOnly, { allowFork: true }).path).toBe("/fork")
  })

  test("a checkout with no origin matches by root without being a fork", () => {
    expect(findCheckouts(want, [{ path: "/local", identity: { root: "r1" } }])).toEqual([
      { path: "/local", via: "root", fork: false },
    ])
  })
})
