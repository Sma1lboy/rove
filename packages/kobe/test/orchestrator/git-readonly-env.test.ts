/**
 * READ_ONLY_GIT_ENV wiring (orchestrator probes must not steal the engine's
 * `.git/index.lock`): every read-only git probe the worktree manager and
 * lander run carries GIT_OPTIONAL_LOCKS=0; every write runs without it.
 *
 * A fake ExecHost records the env each git argv was spawned with — the exact
 * seam where the policy either reaches the child or doesn't. Deterministic:
 * no real git, no timing.
 */

import { describe, expect, it } from "vitest"
import type { ExecHost, ExecResult } from "../../src/exec/exec-host.ts"
import { READ_ONLY_GIT_ENV } from "../../src/lib/git-env.ts"
import { landTask } from "../../src/orchestrator/land.ts"
import type { WorktreeExecDeps } from "../../src/orchestrator/worktree/exec-deps.ts"
import { GitWorktreeManager } from "../../src/orchestrator/worktree/manager.ts"
import type { Task } from "../../src/types/task.ts"
import { toTaskId } from "../../src/types/task.ts"

interface RecordedRun {
  readonly argv: readonly string[]
  readonly env: Readonly<Record<string, string>> | undefined
}

/** Fake ExecHost: script git responses, record argv + env for every run. */
function fakeExec(script: (argv: readonly string[]) => ExecResult) {
  const runs: RecordedRun[] = []
  const exec: ExecHost = {
    isRemote: false,
    async run(argv, opts) {
      runs.push({ argv, env: opts?.env })
      return script(argv)
    },
    exists: async () => true,
    mkdirp: async () => {},
    readFile: async () => null,
    readdir: async () => [],
    wrapCommand: (c) => c,
    ensureReady: () => {},
  }
  return { exec, runs }
}

function depsFor(exec: ExecHost): WorktreeExecDeps {
  return { execForRepo: () => exec, execForPath: () => exec, remoteBasePath: () => null }
}

const ok: ExecResult = { stdout: "", stderr: "", exitCode: 0 }

const flagged = (r: RecordedRun) => r.env?.GIT_OPTIONAL_LOCKS === READ_ONLY_GIT_ENV.GIT_OPTIONAL_LOCKS
const byToken = (runs: RecordedRun[], token: string) => runs.filter((r) => r.argv.includes(token))

describe("GitWorktreeManager — READ_ONLY_GIT_ENV on probes", () => {
  it("isDirty / currentBranch run status and rev-parse lock-free", async () => {
    const { exec, runs } = fakeExec((argv) => {
      if (argv.includes("status")) return { stdout: " M x\n", stderr: "", exitCode: 0 }
      if (argv.includes("--abbrev-ref")) return { stdout: "feat\n", stderr: "", exitCode: 0 }
      return ok
    })
    const mgr = new GitWorktreeManager(depsFor(exec))
    await expect(mgr.isDirty("/wt/a")).resolves.toBe(true)
    await expect(mgr.currentBranch("/wt/a")).resolves.toBe("feat")
    expect(byToken(runs, "--porcelain").every(flagged)).toBe(true)
    expect(byToken(runs, "--abbrev-ref").every(flagged)).toBe(true)
  })

  it("list() probes (worktree list + status) run lock-free", async () => {
    const { exec, runs } = fakeExec((argv) => {
      if (argv.includes("--porcelain")) {
        return {
          stdout: "worktree /repo\nHEAD aaa\nbranch refs/heads/main\n\n",
          stderr: "",
          exitCode: 0,
        }
      }
      return ok
    })
    const mgr = new GitWorktreeManager(depsFor(exec))
    // /repo itself is the main checkout → no managed worktrees, but the
    // porcelain list still ran.
    await expect(mgr.list("/repo")).resolves.toEqual([])
    expect(byToken(runs, "--porcelain").every(flagged)).toBe(true)
  })

  it("listBranchNames / hasLocalBranch / branchHasUpstream run lock-free", async () => {
    const { exec, runs } = fakeExec(() => ok)
    const mgr = new GitWorktreeManager(depsFor(exec))
    await mgr.listBranchNames("/repo")
    await mgr.hasLocalBranch("/wt/a", "feat")
    await mgr.branchHasUpstream("/wt/a", "feat")
    expect(byToken(runs, "for-each-ref").every(flagged)).toBe(true)
    expect(byToken(runs, "show-ref").every(flagged)).toBe(true)
  })

  it("writes (worktree add/remove/prune, branch -m) run WITHOUT the lock-free env", async () => {
    const { exec, runs } = fakeExec((argv) => {
      if (argv.includes("list") && argv.includes("--porcelain")) {
        return {
          stdout: "worktree /wt/a\nHEAD aaa\nbranch refs/heads/feat\n\n",
          stderr: "",
          exitCode: 0,
        }
      }
      if (argv.includes("--git-common-dir")) return { stdout: "/repo/.git\n", stderr: "", exitCode: 0 }
      return ok
    })
    const mgr = new GitWorktreeManager(depsFor(exec))

    await mgr.create("/repo", "feat", "/wt/a")
    await mgr.remove("/wt/a")
    await mgr.renameBranch("/wt/a", "feat", "feat2")

    const writes = runs.filter(
      (r) =>
        (r.argv.includes("add") && r.argv.includes("worktree")) ||
        (r.argv.includes("remove") && r.argv.includes("worktree")) ||
        r.argv.includes("prune") ||
        (r.argv.includes("-m") && r.argv.includes("branch")),
    )
    expect(writes.length).toBeGreaterThan(0)
    expect(writes.every((r) => !flagged(r))).toBe(true)
    // The probes around those writes stayed lock-free.
    expect(byToken(runs, "show-ref").every(flagged)).toBe(true)
    expect(byToken(runs, "--porcelain").every(flagged)).toBe(true)
    expect(byToken(runs, "--git-common-dir").every(flagged)).toBe(true)
  })
})

describe("landTask — READ_ONLY_GIT_ENV on probes", () => {
  it("pre-merge probes run lock-free; the merge itself does not", async () => {
    let headReads = 0
    const { exec, runs } = fakeExec((argv) => {
      if (argv.includes("--abbrev-ref")) return { stdout: "main\n", stderr: "", exitCode: 0 }
      if (argv.includes("status")) return ok
      if (argv.includes("rev-list")) return { stdout: "1\n", stderr: "", exitCode: 0 }
      if (argv.includes("merge")) return ok
      if (argv.includes("rev-parse") && argv.includes("--short")) {
        return { stdout: "bbb1234\n", stderr: "", exitCode: 0 }
      }
      if (argv.includes("rev-parse")) {
        headReads++
        return { stdout: headReads === 1 ? "aaa\n" : "bbb\n", stderr: "", exitCode: 0 }
      }
      return ok
    })
    const now = new Date().toISOString()
    const task: Task = {
      id: toTaskId("t-ro"),
      title: "t",
      repo: "/repo",
      branch: "feat",
      worktreePath: "",
      status: "backlog",
      kind: "task",
      createdAt: now,
      updatedAt: now,
    }
    const result = await landTask(task, {}, depsFor(exec))
    expect(result.landedOn).toBe("main")

    const probes = runs.filter((r) => !r.argv.includes("merge"))
    expect(probes.every(flagged)).toBe(true)
    const merge = runs.find((r) => r.argv.includes("merge"))
    expect(merge).toBeDefined()
    expect(flagged(merge!)).toBe(false)
  })
})
