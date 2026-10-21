import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { computeRepoId, repoIdOf } from "@sma1lboy/rove-daemon/repo-id"
import { afterAll, describe, expect, test } from "vitest"

const scratch = mkdtempSync(join(tmpdir(), "rove-repo-id-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { encoding: "utf8" }).trim()

function repo(name: string, origin?: string): string {
  const dir = join(scratch, name)
  mkdirSync(dir)
  git(dir, "init", "-q")
  git(dir, "commit", "-q", "--allow-empty", "-m", "root")
  if (origin) git(dir, "remote", "add", "origin", origin)
  return dir
}

describe("repo id", () => {
  test("a repo with an origin is its normalized remote, whatever the checkout's path", () => {
    expect(computeRepoId(repo("a", "git@github.com:Me/Rove.git"))).toBe("github.com/me/rove")
    expect(computeRepoId(repo("b", "https://github.com/me/rove"))).toBe("github.com/me/rove")
  })

  test("without an origin it is the root commit", () => {
    const dir = repo("local-only")
    expect(computeRepoId(dir)).toBe(`root:${git(dir, "rev-list", "--max-parents=0", "HEAD")}`)
  })

  test("a plain directory or a missing path has none", () => {
    const plain = join(scratch, "plain")
    mkdirSync(plain)
    expect(repoIdOf(plain)).toBeUndefined()
    expect(repoIdOf(join(scratch, "missing"))).toBeUndefined()
    expect(repoIdOf("")).toBeUndefined()
  })

  test("memoized per path: a remote added later does not change it until restart", () => {
    const dir = repo("later")
    const first = repoIdOf(dir)
    git(dir, "remote", "add", "origin", "git@github.com:me/later.git")
    expect(repoIdOf(dir)).toBe(first)
    expect(computeRepoId(dir)).toBe("github.com/me/later")
  })
})
