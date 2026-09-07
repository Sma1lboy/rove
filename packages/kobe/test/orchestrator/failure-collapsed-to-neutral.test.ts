/**
 * Five probes that reported a NEUTRAL answer when they had failed.
 *
 * One file because they are one bug wearing five costumes: an error path
 * folded into the value a healthy run produces, so the layer above cannot tell
 * "nothing is wrong" from "nothing was checked". Each test below fails if its
 * fix is reverted, and only that one.
 *
 * The delete-gate and branch-delete halves need real git — a stub cannot
 * produce git's own refusal of an unmerged branch, which is the whole subject.
 */

import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { collectOrphans, markedPids } from "../../src/cli/doctor-orphans.ts"
import { isDirtyOutput } from "../../src/orchestrator/dirty-paths.ts"
import { isDirty as landIsDirty } from "../../src/orchestrator/land-preflight.ts"
import { GitWorktreeManager } from "../../src/orchestrator/worktree/manager.ts"
import { smallIgnoredPaths } from "../../src/orchestrator/worktree/salvage-ignored.ts"

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" })
}

describe("a git-refused branch delete is reported, not swallowed", () => {
  let root: string
  let repo: string
  let worktree: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "rove-branch-kept-"))
    repo = join(root, "repo")
    worktree = join(root, "wt")
    execFileSync("mkdir", ["-p", repo])
    git(repo, "init", "-q", "-b", "main", ".")
    writeFileSync(join(repo, "f.txt"), "base\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "base")
    git(repo, "worktree", "add", "-q", "-b", "feature", worktree)
    writeFileSync(join(worktree, "NEW.txt"), "work\n")
    git(worktree, "add", "-A")
    git(worktree, "commit", "-qm", "unmerged")
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it("hands back git's refusal for an unmerged branch instead of reporting success", async () => {
    const kept: { branch: string; reason: string }[] = []
    // `git branch -d` on a branch with commits the base cannot reach: git
    // refuses, exit 1. Before, that exit code was discarded and `delete
    // --delete-branch` finished quietly with the branch still on disk.
    await new GitWorktreeManager().remove(worktree, {
      force: false,
      deleteBranch: true,
      onBranchKept: (k) => kept.push(k),
    })

    expect(kept).toHaveLength(1)
    expect(kept[0]?.branch).toBe("feature")
    expect(kept[0]?.reason).toMatch(/not fully merged/)
    // The removal itself still succeeded, and the branch still exists — the
    // fix changes what is REPORTED, never what is destroyed.
    expect(git(repo, "branch", "--format=%(refname:short)")).toContain("feature")
  })

  it("stays silent when the branch really did go away", async () => {
    git(repo, "checkout", "-q", "main")
    git(repo, "merge", "-q", "--no-ff", "-m", "merge", "feature")
    const kept: unknown[] = []
    await new GitWorktreeManager().remove(worktree, {
      force: false,
      deleteBranch: true,
      onBranchKept: (k) => kept.push(k),
    })
    expect(kept).toEqual([])
    expect(git(repo, "branch", "--format=%(refname:short)")).not.toContain("feature")
  })
})

describe("one definition of a dirty porcelain", () => {
  // A remote ExecHost is where a bare trailing newline actually comes from.
  // It used to read DIRTY to the worktree manager's delete gate and CLEAN to
  // landing — the same worktree, two verdicts, and the destructive one was
  // the odd man out.
  const newlineOnly = {
    isRemote: true,
    run: async () => ({ stdout: "\n", stderr: "", exitCode: 0 }),
    exists: async () => true,
  }

  it('agrees that "\\n" is clean', async () => {
    expect(isDirtyOutput("\n")).toBe(false)
    expect(isDirtyOutput("")).toBe(false)
    expect(isDirtyOutput(" M src/a.ts\n")).toBe(true)
  })

  it("gives all three call sites the same verdict on the same stdout", async () => {
    // Asserting the shared helper alone would not notice a call site quietly
    // going back to its own notion of empty, which is exactly the drift.
    const manager = new GitWorktreeManager({
      execForRepo: () => newlineOnly as never,
      execForPath: () => newlineOnly as never,
      remoteBasePath: () => "/remote/base",
    })
    expect(await manager.isDirty("/remote/base/wt")).toBe(false)
    expect(await landIsDirty(newlineOnly as never, "/repo")).toBe(false)
    // sync calls `parseDirtyPaths` directly, which is what `isDirtyOutput`
    // is defined as — so this assertion covers that third site too.
    expect(isDirtyOutput("\n")).toBe(false)
  })
})

describe("an ignored-work probe that did not run is not an empty worktree", () => {
  const worktreePath = "/wt/x"

  function execWith(statusExit: number) {
    return {
      isRemote: false,
      exists: async () => true,
      run: async (argv: readonly string[]) =>
        argv[0] === "git"
          ? { stdout: "", stderr: "fatal: not a git repository", exitCode: statusExit }
          : { stdout: "", stderr: "", exitCode: 0 },
    }
  }

  it('reports "unknown" when `git status --ignored` exits non-zero', async () => {
    expect(await smallIgnoredPaths(execWith(128) as never, worktreePath)).toBe("unknown")
    expect(await smallIgnoredPaths(execWith(0) as never, worktreePath)).toEqual([])
  })

  it("refuses the removal rather than treating the unread listing as permission", async () => {
    const manager = new GitWorktreeManager()
    // The gate reads `ignoredWork`; stub only that, so the rest of `remove()`
    // is the real thing and the refusal has to come from the gate.
    Object.defineProperty(manager, "ignoredWork", {
      value: async () => "unknown" as const,
      configurable: true,
    })
    Object.defineProperty(manager, "isDirty", { value: async () => false, configurable: true })
    const root = mkdtempSync(join(tmpdir(), "rove-ignored-unknown-"))
    try {
      const repo = join(root, "repo")
      const wt = join(root, "wt")
      execFileSync("mkdir", ["-p", repo])
      git(repo, "init", "-q", "-b", "main", ".")
      writeFileSync(join(repo, "f.txt"), "base\n")
      git(repo, "add", "-A")
      git(repo, "commit", "-qm", "base")
      git(repo, "worktree", "add", "-q", "-b", "feature", wt)

      await expect(manager.remove(wt, { force: false })).rejects.toThrow(/status --ignored failed/)
      // Refused means NOT destroyed: the point of the gate.
      expect(git(repo, "worktree", "list")).toContain(wt)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("doctor's orphan sweep says so when it could not look", () => {
  // ppid 1 and a process group whose leader (4000) is NOT in the table: an
  // orphan CANDIDATE. Only the environment read decides whether it is a
  // finding, which is exactly the step that used to fail silently.
  const psRow = "4242     1  4000 01:00 1024 bun run something\n"

  it("reports a `ps eww` that never ran instead of a clean machine", async () => {
    const { orphans, error } = await collectOrphans(new Set(), {
      platform: "darwin",
      run: async (argv) =>
        // the structural pass answers; the ENVIRONMENT pass — the one that
        // turns a candidate into a finding — is the one that fails.
        argv[1] === "-A" ? { code: 0, stdout: psRow } : { code: 127, stdout: "" },
    })
    expect(orphans).toEqual([])
    expect(error).toMatch(/could not read process environments/)
  })

  it("reports a refused /proc read, but not a process that simply exited", async () => {
    const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" })
    const eacces = Object.assign(new Error("EACCES"), { code: "EACCES" })
    const gone = await markedPids([1], {
      platform: "linux",
      readEnviron: () => {
        throw enoent
      },
    })
    expect(gone.failed).toBeNull()

    const refused = await markedPids([1], {
      platform: "linux",
      readEnviron: () => {
        throw eacces
      },
    })
    expect(refused.failed).toMatch(/EACCES/)
  })
})
