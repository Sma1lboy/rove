import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { matchRepo, normalizeRemoteUrl, unpushedCommits } from "../../src/machines/repo-identity.ts"

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

describe("unpushedCommits", () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { encoding: "utf8" })
  const setup = () => {
    const root = mkdtempSync(join(tmpdir(), "rove-unpushed-"))
    const origin = join(root, "origin.git")
    const work = join(root, "work")
    execFileSync("git", ["init", "-q", "--bare", origin])
    execFileSync("git", ["clone", "-q", origin, work])
    git(work, "commit", "-q", "--allow-empty", "-m", "one")
    git(work, "branch", "-M", "main")
    git(work, "push", "-q", "-u", "origin", "main")
    return { root, work }
  }

  test("a pushed branch has none; a commit past its upstream counts", () => {
    const { root, work } = setup()
    try {
      expect(unpushedCommits(work, "main")).toBe(0)
      git(work, "commit", "-q", "--allow-empty", "-m", "two")
      expect(unpushedCommits(work, "main")).toBe(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("a branch with no upstream counts what no remote reaches", () => {
    const { root, work } = setup()
    try {
      git(work, "switch", "-q", "-c", "feat/x")
      expect(unpushedCommits(work, "feat/x")).toBe(0)
      git(work, "commit", "-q", "--allow-empty", "-m", "local only")
      expect(unpushedCommits(work, "feat/x")).toBe(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("a ref this checkout does not have is not judged", () => {
    const { root, work } = setup()
    try {
      expect(unpushedCommits(work, "only-on-the-other-machine")).toBeNull()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
