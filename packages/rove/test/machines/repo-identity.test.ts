import { describe, expect, test } from "vitest"
import { matchRepo, normalizeRemoteUrl } from "../../src/machines/repo-identity.ts"

describe("normalizeRemoteUrl", () => {
  test("every common form of one GitHub remote compares equal", () => {
    const forms = [
      "git@github.com:Sma1lboy/rove.git",
      "https://github.com/Sma1lboy/rove",
      "https://github.com/sma1lboy/rove.git/",
      "ssh://git@github.com/Sma1lboy/rove.git",
      "ssh://git@github.com:22/Sma1lboy/rove",
    ]
    expect(new Set(forms.map(normalizeRemoteUrl))).toEqual(new Set(["github.com/sma1lboy/rove"]))
  })

  test("different repos stay different", () => {
    expect(normalizeRemoteUrl("git@github.com:me/a.git")).not.toBe(normalizeRemoteUrl("git@github.com:me/b.git"))
  })
})

describe("matchRepo", () => {
  const candidates = [
    { path: "/Users/me/i/rove", identity: { origin: "github.com/me/rove", root: "aaa" } },
    { path: "/Users/me/fork", identity: { origin: "github.com/other/rove", root: "aaa" } },
    { path: "/Users/me/app", identity: { origin: "github.com/me/app", root: "bbb" } },
  ]

  test("a shared root commit wins over the remote's name", () => {
    expect(matchRepo({ origin: "github.com/other/rove", root: "aaa" }, candidates)).toBe("/Users/me/i/rove")
  })

  test("without a root (a shallow clone) the origin decides", () => {
    expect(matchRepo({ origin: "github.com/me/app" }, candidates)).toBe("/Users/me/app")
  })

  test("nothing in common is no match, not a guess", () => {
    expect(matchRepo({ origin: "github.com/me/zzz", root: "ccc" }, candidates)).toBeNull()
  })
})
