/**
 * `src/tui/lib/sibling-repos.ts` — the disk scan that turns one known repo
 * into the list of repos next to it, so the new-task dialog has something to
 * offer on a fresh install and a never-saved checkout is still pickable.
 *
 * Real directories under a tmpdir rather than mocks: the module is nothing
 * but fs calls, and the cases that matter (a `.git` FILE for a worktree, a
 * hidden entry, a plain directory, a cwd deep inside a repo) are all about
 * what the filesystem actually reports.
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { discoverSiblingRepos, nearestGitRoot } from "@/tui/lib/sibling-repos"
import { afterEach, describe, expect, it } from "vitest"

const roots: string[] = []
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true })
})
function scratch(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rove-siblings-"))
  roots.push(dir)
  return dir
}
function gitDir(parent: string, name: string): string {
  const full = path.join(parent, name)
  fs.mkdirSync(path.join(full, ".git"), { recursive: true })
  return full
}

describe("nearestGitRoot", () => {
  it("returns the repo itself when handed its root", () => {
    const repo = gitDir(scratch(), "repo")
    expect(nearestGitRoot(repo)).toBe(repo)
  })

  it("walks up from a subdirectory to the checkout root", () => {
    // The dialog's cwd default is often `rove/packages/kobe` — its parent
    // holds no repos, the root's parent does.
    const repo = gitDir(scratch(), "mono")
    const deep = path.join(repo, "packages", "app")
    fs.mkdirSync(deep, { recursive: true })
    expect(nearestGitRoot(deep)).toBe(repo)
  })

  it("is null when nothing above the path is a checkout", () => {
    const plain = path.join(scratch(), "plain", "deeper")
    fs.mkdirSync(plain, { recursive: true })
    // A tmpdir under the OS temp root is not inside any repo. (If the
    // machine's temp root somehow is, this test cannot tell, so accept
    // either null or an ancestor of the tmpdir.)
    const got = nearestGitRoot(plain)
    expect(got === null || !plain.startsWith(`${got}${path.sep}`) || got.length < os.tmpdir().length + 1).toBe(true)
  })
})

describe("discoverSiblingRepos", () => {
  it("lists the git checkouts under a known repo's parent, sorted by name", () => {
    const parent = scratch()
    const known = gitDir(parent, "rove")
    gitDir(parent, "zod")
    gitDir(parent, "axios")
    fs.mkdirSync(path.join(parent, "notes")) // plain directory — not a repo
    fs.writeFileSync(path.join(parent, "README.md"), "") // a file
    expect(discoverSiblingRepos([known])).toEqual([
      path.join(parent, "axios"),
      path.join(parent, "rove"),
      path.join(parent, "zod"),
    ])
  })

  it("counts a .git FILE (linked worktree) as a checkout", () => {
    const parent = scratch()
    const known = gitDir(parent, "main")
    const wt = path.join(parent, "wt")
    fs.mkdirSync(wt)
    fs.writeFileSync(path.join(wt, ".git"), "gitdir: elsewhere\n")
    expect(discoverSiblingRepos([known])).toEqual([known, wt])
  })

  it("skips hidden directories", () => {
    const parent = scratch()
    const known = gitDir(parent, "repo")
    gitDir(parent, ".hidden-repo")
    expect(discoverSiblingRepos([known])).toEqual([known])
  })

  it("scans each distinct parent once, in the order the known repos name them", () => {
    const a = scratch()
    const b = scratch()
    const a1 = gitDir(a, "one")
    const a2 = gitDir(a, "two")
    const b1 = gitDir(b, "three")
    // `a` is named twice; it must be listed once, and before `b`.
    expect(discoverSiblingRepos([a2, b1, a1])).toEqual([a1, a2, b1])
  })

  it("ignores known entries that are not absolute local paths", () => {
    // A `~/` spelling, an ssh key, a bare name: nothing to list under.
    expect(discoverSiblingRepos(["~/Projects/x", "ssh://host/repo", "bare", "  "])).toEqual([])
  })

  it("tolerates a parent that cannot be read", () => {
    const gone = path.join(scratch(), "vanished", "repo")
    expect(discoverSiblingRepos([gone])).toEqual([])
  })
})
