/**
 * A git command that fails during a land must say WHY.
 *
 * Both strategies used to read a non-zero exit from the committing command as
 * the one benign cause they knew about, and neither ever looked at git's
 * stderr: squash reported "already merged or empty" about a branch that had
 * just staged cleanly (and then `reset --hard` discarded the squash), while
 * merge threw a phantom `LAND_CONFLICT` with an empty file list. A repo-local
 * `pre-commit` hook, a broken `commit.gpgsign` key, or an unset `user.email`
 * all reach both paths.
 *
 * Real git in a temp repo for the three realistic shapes — the whole point is
 * what git actually does when it refuses to commit, which a mock would only
 * restate. One injected-ExecHost case covers the genuinely-empty squash, which
 * real git cannot reach here because `assertBranchHasWork` refuses a
 * zero-commit branch before the merge.
 */

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import type { ExecHost } from "../../src/exec/exec-host.ts"
import { GIT_COMMAND_FAILED_CODE, LandConflictError } from "../../src/orchestrator/errors.ts"
import { landTask } from "../../src/orchestrator/land.ts"
import type { WorktreeExecDeps } from "../../src/orchestrator/worktree/exec-deps.ts"
import type { Task } from "../../src/types/task.ts"
import { toTaskId } from "../../src/types/task.ts"

/**
 * Per-test budget for this file, replacing vitest's 5000ms default.
 *
 * Each case here runs twenty real `git` processes — counted with a PATH shim:
 * fourteen through the fixture's synchronous helpers (repo setup, the diverged
 * branch, the broken signing config, the closing `status`) and six through
 * `landTask`'s own async `ExecHost`. There is nothing to wait on and no race;
 * the cost is entirely process spawn, which on windows-latest (Git-for-Windows'
 * fork emulation plus on-access scanning of every child) runs an order of
 * magnitude above the ~25ms it costs here.
 *
 * The default is worse than just small — it measures the wrong subset. The
 * fixture's `git()`/`gitOk()` are `spawnSync`, which pins the event loop, so
 * vitest's timer cannot fire while they run. Measured with a shim that adds a
 * fixed delay per spawn: at 600ms/spawn this file burns 43 SECONDS of wall
 * clock and still reports green; at 900ms/spawn it fails `Test timed out in
 * 5000ms`. Only the six async spawns are ever on a clock, so the threshold is
 * really "an async git spawn costs more than ~830ms", which a loaded Windows
 * runner sits right on. Budget the whole thing instead.
 */
const GIT_SPAWN_HEAVY_TIMEOUT_MS = 30_000

let tmpRoot: string
let repo: string

function git(args: string[], cwd = repo): { stdout: string; status: number | null } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" })
  return { stdout: r.stdout, status: r.status }
}

function gitOk(args: string[], cwd = repo): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" })
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`)
}

function task(branch: string): Task {
  const now = new Date().toISOString()
  return {
    id: toTaskId("t-land-fail"),
    title: "t",
    repo,
    branch,
    worktreePath: "",
    status: "backlog",
    kind: "task",
    createdAt: now,
    updatedAt: now,
  }
}

/** A branch one commit ahead of main, with main also moved on (so squash stages). */
function branchAheadOfMovedMain(): void {
  gitOk(["checkout", "-b", "feat"])
  fs.writeFileSync(path.join(repo, "g.txt"), "feature\n")
  gitOk(["add", "-A"])
  gitOk(["commit", "-m", "feat"])
  gitOk(["checkout", "main"])
  fs.appendFileSync(path.join(repo, "f.txt"), "main moved\n")
  gitOk(["add", "-A"])
  gitOk(["commit", "-m", "main2"])
}

/** Make every `git commit` in the repo fail, the way a real signing key does. */
function breakCommitting(): void {
  gitOk(["config", "commit.gpgsign", "true"])
  gitOk(["config", "user.signingkey", "DEADBEEFNOTAKEY"])
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kobe-land-fail-"))
  repo = path.join(tmpRoot, "repo")
  fs.mkdirSync(repo)
  gitOk(["init", "-b", "main"])
  gitOk(["config", "user.email", "t@t.t"])
  gitOk(["config", "user.name", "t"])
  fs.writeFileSync(path.join(repo, "f.txt"), "base\n")
  gitOk(["add", "-A"])
  gitOk(["commit", "-m", "base"])
})

afterEach(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  } catch {
    // ignored
  }
})

describe("a git commit that fails mid-land", { timeout: GIT_SPAWN_HEAVY_TIMEOUT_MS }, () => {
  test("squash surfaces git's own error and does NOT reset the staged merge away", async () => {
    branchAheadOfMovedMain()
    breakCommitting()

    const err = await landTask(task("feat"), { strategy: "squash" }).then(
      () => null,
      (e: unknown) => e as Error,
    )

    expect(err?.message).toContain(GIT_COMMAND_FAILED_CODE)
    // git's real reason, not Rove's guess.
    expect(err?.message).toContain("DEADBEEFNOTAKEY")
    expect(err?.message).not.toContain("already merged or empty")
    // The staged squash survives — a `reset --hard` here throws away a merge
    // that succeeded, over a problem one `git config` fixes.
    expect(git(["status", "--porcelain"]).stdout).toContain("g.txt")
    expect(fs.existsSync(path.join(repo, "g.txt"))).toBe(true)
  })

  test("merge reports a commit-time failure as itself, never as a phantom conflict", async () => {
    branchAheadOfMovedMain()
    breakCommitting()

    const err = await landTask(task("feat"), { strategy: "merge" }).then(
      () => null,
      (e: unknown) => e as Error,
    )

    expect(err).not.toBeInstanceOf(LandConflictError)
    expect(err?.message).toContain(GIT_COMMAND_FAILED_CODE)
    expect(err?.message).toContain("DEADBEEFNOTAKEY")
    // The merge is still aborted, so the base checkout is left clean.
    expect(git(["status", "--porcelain"]).stdout.trim()).toBe("")
    expect(fs.existsSync(path.join(repo, ".git", "MERGE_HEAD"))).toBe(false)
  })

  test("a REAL conflict is still a LandConflictError with its file list", async () => {
    gitOk(["checkout", "-b", "feat"])
    fs.writeFileSync(path.join(repo, "f.txt"), "theirs\n")
    gitOk(["add", "-A"])
    gitOk(["commit", "-m", "feat edits f"])
    gitOk(["checkout", "main"])
    fs.writeFileSync(path.join(repo, "f.txt"), "ours\n")
    gitOk(["add", "-A"])
    gitOk(["commit", "-m", "main edits f"])

    const err = await landTask(task("feat"), { strategy: "merge" }).then(
      () => null,
      (e: unknown) => e as Error,
    )

    expect(err).toBeInstanceOf(LandConflictError)
    expect(err?.message).toContain("f.txt")
  })

  // Reachable only with an injected host: `assertBranchHasWork` refuses a
  // zero-commit branch before the squash, so real git cannot produce "the
  // squash staged nothing" here. The behaviour still has to survive.
  test("a squash that genuinely staged nothing keeps the old message and the reset", async () => {
    const calls: string[][] = []
    const exec = {
      isRemote: false,
      async run(argv: readonly string[]) {
        const args = argv.slice(1)
        calls.push([...args])
        const joined = args.join(" ")
        if (joined.startsWith("symbolic-ref --short")) return ok("main")
        if (joined.startsWith("status --porcelain")) return ok("")
        if (joined.startsWith("rev-list --count")) return ok("1") // "has work"
        if (joined.startsWith("merge --squash")) return ok("")
        if (joined.startsWith("commit ")) return fail("nothing to commit, working tree clean")
        if (joined === "diff --cached --quiet") return ok("") // exit 0 = nothing staged
        return ok("")
      },
    } as unknown as ExecHost
    const deps: WorktreeExecDeps = {
      execForRepo: () => exec,
      execForPath: () => exec,
      remoteBasePath: () => null,
    }

    await expect(landTask(task("feat"), { strategy: "squash" }, deps)).rejects.toThrow(/already merged or empty/)
    expect(calls.some((c) => c[0] === "reset" && c[1] === "--hard")).toBe(true)
  })
})

function ok(stdout: string) {
  return { stdout, stderr: "", exitCode: 0 }
}

function fail(stderr: string) {
  return { stdout: "", stderr, exitCode: 1 }
}
