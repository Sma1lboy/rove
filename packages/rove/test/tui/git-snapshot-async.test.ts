import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import * as sync from "../../src/tui/lib/git-snapshot"
import * as async from "../../src/tui/lib/git-snapshot-async"

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, stdio: "ignore" })

describe("the async git snapshot", () => {
  it("answers as the sync one does: a plain folder, a repo with no commit, a repo with branches", async () => {
    const root = mkdtempSync(join(tmpdir(), "rove-git-snap-"))
    const plain = join(root, "plain")
    const unborn = join(root, "unborn")
    const repo = join(root, "repo")
    mkdirSync(plain)
    mkdirSync(unborn)
    mkdirSync(repo)
    git(unborn, "init", "-q", "-b", "main")
    git(repo, "init", "-q", "-b", "main")
    writeFileSync(join(repo, "a"), "a")
    git(repo, "add", "a")
    git(repo, "commit", "-qm", "init")
    git(repo, "branch", "zeta")
    git(repo, "branch", "develop")
    git(repo, "checkout", "-q", "zeta")

    const dirs = [plain, unborn, repo, join(root, "missing"), ""]
    expect(await Promise.all(dirs.map((dir) => async.validateRepoPath(dir)))).toEqual(
      dirs.map((dir) => sync.validateRepoPath(dir)),
    )
    expect(await async.validateRepoPath(repo)).toBeNull()
    expect(await async.listLocalBranches(repo)).toEqual(["main", "develop", "zeta"])
    expect(await async.getCurrentBranch(repo)).toBe("zeta")
    expect(await async.getCurrentBranch(plain)).toBeNull()
  })
})
