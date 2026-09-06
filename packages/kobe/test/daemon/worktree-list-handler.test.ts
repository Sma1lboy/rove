/**
 * `worktree.list` / `worktree.remove` — the standalone worktree-management
 * page's daemon handlers (`packages/kobe-daemon/src/daemon/handlers-worktree.ts`).
 * Unlike the mock-based `handlers.test.ts` suite, these two handlers bypass
 * `ctx.orch` entirely (they compose `GitWorktreeManager` + `getSavedRepos()`
 * directly — see the handler file's doc comment), so a fake Orchestrator
 * can't observe them. Real temp git repos + a sandboxed `KOBE_HOME_DIR`
 * (same convention as `worktree-manager-edges.test.ts`) exercise the actual
 * composition: saved-repo discovery, the new `createdAtMs`/`branchOnRemote`
 * fields, and the dirty-refusal → force-delete safety gate.
 */

import { execSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type DaemonHandlerContext,
  createDaemonHandlerRegistry,
  dispatchDaemonRequest,
} from "@sma1lboy/kobe-daemon/daemon/server"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { daemonRuntime } from "../../src/core/daemon-runtime.ts"
import { addSavedRepo } from "../../src/state/repos.ts"

/**
 * The wire contract, spelled out rather than imported: the RPC layer rebuilds
 * a thrown error as `new Error(message)`, so this prefix is all a caller across
 * the daemon boundary ever sees. Importing the daemon-side constant would let a
 * rename of both sides pass while every existing caller broke.
 */
const NOT_A_ROVE_WORKTREE = "NOT_A_ROVE_WORKTREE"

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
}

const FAKE_CTX = { runtime: daemonRuntime } as DaemonHandlerContext

function dispatch(name: string, payload: unknown): Promise<unknown> {
  return dispatchDaemonRequest(createDaemonHandlerRegistry(), name, payload, FAKE_CTX)
}

let root: string
let repo: string
let prevHome: string | undefined

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "kobe-wt-list-")))
  prevHome = process.env.KOBE_HOME_DIR
  process.env.KOBE_HOME_DIR = root
  repo = join(root, "repo")
  mkdirSync(repo)
  execSync("git init -q -b main && git commit -q --allow-empty -m init", { cwd: repo, env: gitEnv })
  addSavedRepo(repo)
})

afterEach(() => {
  if (prevHome === undefined) Reflect.deleteProperty(process.env, "KOBE_HOME_DIR")
  else process.env.KOBE_HOME_DIR = prevHome
  rmSync(root, { recursive: true, force: true })
})

describe("worktree.list", () => {
  it("lists a saved repo's worktrees with kobeManaged/dirty/createdAtMs/branchOnRemote", async () => {
    const wt = join(root, "adhoc-worktree")
    execSync(`git worktree add -b feature/demo ${JSON.stringify(wt)}`, { cwd: repo, env: gitEnv })

    const result = (await dispatch("worktree.list", {})) as {
      projects: Array<{ repo: string; worktrees: Array<Record<string, unknown>> }>
    }

    const project = result.projects.find((p) => p.repo === repo)
    expect(project).toBeDefined()
    expect(project?.worktrees).toHaveLength(1)
    const row = project?.worktrees[0]
    expect(row?.branch).toBe("feature/demo")
    // Created via plain `git worktree add`, not kobe's convention root.
    expect(row?.kobeManaged).toBe(false)
    expect(row?.dirty).toBe(false)
    expect(typeof row?.createdAtMs).toBe("number")
    expect(row?.createdAtMs as number).toBeGreaterThan(0)
    // No `origin` configured on this throwaway repo — unreachable, not "not pushed".
    expect(row?.branchOnRemote).toBeNull()
  })

  it("includes a repo with no worktrees in the result rather than erroring", async () => {
    const result = (await dispatch("worktree.list", {})) as { projects: Array<{ repo: string }> }
    const project = result.projects.find((p) => p.repo === repo)
    expect(project).toBeDefined()
  })
})

describe("worktree.remove", () => {
  it("removes a clean worktree without force", async () => {
    const wt = join(root, "clean-worktree")
    execSync(`git worktree add -b feature/clean ${JSON.stringify(wt)}`, { cwd: repo, env: gitEnv })

    await expect(dispatch("worktree.remove", { path: wt })).resolves.toEqual({ removed: true })
    expect(() => execSync("git worktree list", { cwd: repo, env: gitEnv }).toString()).not.toThrow()
    expect(execSync("git worktree list", { cwd: repo, env: gitEnv }).toString()).not.toContain(wt)
  })

  it("refuses a dirty worktree, then removes it once force is set — the same gate as GitWorktreeManager.remove", async () => {
    const wt = join(root, "dirty-worktree")
    execSync(`git worktree add -b feature/dirty ${JSON.stringify(wt)}`, { cwd: repo, env: gitEnv })
    writeFileSync(join(wt, "untracked.txt"), "uncommitted")

    await expect(dispatch("worktree.remove", { path: wt })).rejects.toThrow(/refusing to remove dirty worktree/)
    await expect(dispatch("worktree.remove", { path: wt, force: true })).resolves.toEqual({ removed: true })
  })

  it("rejects a missing path", async () => {
    await expect(dispatch("worktree.remove", {})).rejects.toThrow("path is required")
  })

  /**
   * The engine must be killed BEFORE the directory is unlinked.
   *
   * `git worktree remove` succeeds against a live process — POSIX unlink does
   * not care that something holds the directory as its cwd — so an engine
   * still running writes every subsequent file into an unlinked inode: not on
   * disk, not in the branch, and not in the salvage snapshot (which ran
   * before those writes). The task-deletion path already ordered it this way;
   * this handler did not.
   *
   * The assertion is the ORDER, recorded by the teardown fake at the moment
   * it runs. Asserting only "teardown was called" would pass just as happily
   * with the calls the wrong way round, which is the bug.
   */
  it("tears the engine session down BEFORE unlinking the directory", async () => {
    const wt = join(root, "live-worktree")
    execSync(`git worktree add -b feature/live ${JSON.stringify(wt)}`, { cwd: repo, env: gitEnv })

    const order: string[] = []
    const ctx = {
      runtime: {
        ...daemonRuntime,
        tearDownTaskSession: async (taskId: string) => {
          // Existing at teardown time is the whole point: after the removal
          // this is false, and an engine writing here would write to nothing.
          order.push(`teardown:${taskId}:dirExists=${existsSync(wt)}`)
        },
      },
      orch: {
        listTasks: () => [{ id: "task-live", worktreePath: wt }],
        clearWorktreePath: async () => {
          order.push("clearWorktreePath")
        },
      },
    } as unknown as DaemonHandlerContext

    await expect(
      dispatchDaemonRequest(createDaemonHandlerRegistry(), "worktree.remove", { path: wt }, ctx),
    ).resolves.toEqual({ removed: true })

    expect(order).toEqual(["teardown:task-live:dirExists=true", "clearWorktreePath"])
    expect(existsSync(wt)).toBe(false)
  })

  /**
   * Ordering, not gating. The worktrees page's delete is optimistic — the row
   * has already left the user's screen — and a task whose engine is already
   * dead throws here the same way a stuck one does. Blocking on that would
   * strand every such worktree permanently.
   */
  it("still removes the worktree when session teardown fails", async () => {
    const wt = join(root, "teardown-fails")
    execSync(`git worktree add -b feature/teardown-fails ${JSON.stringify(wt)}`, { cwd: repo, env: gitEnv })

    const ctx = {
      runtime: {
        ...daemonRuntime,
        tearDownTaskSession: async () => {
          throw new Error("session host unreachable")
        },
      },
      orch: { listTasks: () => [{ id: "task-x", worktreePath: wt }], clearWorktreePath: async () => {} },
    } as unknown as DaemonHandlerContext

    await expect(
      dispatchDaemonRequest(createDaemonHandlerRegistry(), "worktree.remove", { path: wt }, ctx),
    ).resolves.toEqual({ removed: true })
    expect(existsSync(wt)).toBe(false)
  })

  /**
   * `worktree.remove` is the only destructive path that addresses a worktree
   * by PATH rather than by task id, and it was the only one that never asked
   * what KIND of task owns it. A `dir` task's path is the user's own
   * directory, a `main` task's is the project checkout — neither is a
   * Rove-created worktree, and both can reach this handler because
   * `worktree.list` enumerates every registered worktree of a saved project.
   *
   * The assertion is that the DIRECTORY survives, not just that the call
   * threw: the pre-fix bug removed the files and then skipped the repair
   * (`clearWorktreePath` early-returns for these two kinds), so the task was
   * left pointing at a path that no longer existed.
   */
  function ctxWithTask(task: { id: string; worktreePath: string; kind?: string }): DaemonHandlerContext {
    return {
      runtime: { ...daemonRuntime, tearDownTaskSession: async () => {} },
      orch: { listTasks: () => [task], clearWorktreePath: async () => {} },
    } as unknown as DaemonHandlerContext
  }

  it("refuses to delete a dir task's own directory, and leaves it on disk", async () => {
    const wt = join(root, "user-directory")
    execSync(`git worktree add -b feature/dir-task ${JSON.stringify(wt)}`, { cwd: repo, env: gitEnv })

    await expect(
      dispatchDaemonRequest(
        createDaemonHandlerRegistry(),
        "worktree.remove",
        { path: wt },
        ctxWithTask({ id: "task-dir", worktreePath: wt, kind: "dir" }),
      ),
    ).rejects.toThrow(new RegExp(`^${NOT_A_ROVE_WORKTREE}: `))
    expect(existsSync(wt)).toBe(true)
  })

  it("refuses to delete a main task's project checkout, and leaves it on disk", async () => {
    const wt = join(root, "project-checkout")
    execSync(`git worktree add -b feature/main-task ${JSON.stringify(wt)}`, { cwd: repo, env: gitEnv })

    await expect(
      dispatchDaemonRequest(
        createDaemonHandlerRegistry(),
        "worktree.remove",
        { path: wt },
        ctxWithTask({ id: "task-main", worktreePath: wt, kind: "main" }),
      ),
    ).rejects.toThrow(new RegExp(`^${NOT_A_ROVE_WORKTREE}: `))
    expect(existsSync(wt)).toBe(true)
  })

  // Positive control: the guard reads `kind`, not "this path owns a task".
  // Without this, a guard that refused every tracked worktree would pass the
  // two tests above while breaking the handler's entire purpose.
  it("still removes a managed task's worktree", async () => {
    const wt = join(root, "managed-worktree")
    execSync(`git worktree add -b feature/managed ${JSON.stringify(wt)}`, { cwd: repo, env: gitEnv })

    await expect(
      dispatchDaemonRequest(
        createDaemonHandlerRegistry(),
        "worktree.remove",
        { path: wt },
        ctxWithTask({ id: "task-managed", worktreePath: wt, kind: "task" }),
      ),
    ).resolves.toEqual({ removed: true })
    expect(existsSync(wt)).toBe(false)
  })
})
