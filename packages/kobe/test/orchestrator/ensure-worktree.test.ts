/**
 * `Orchestrator.ensureWorktree` idempotency + partial-failure cleanup
 * (stability fix C). Real git + real store on disk, mirroring the harness in
 * `worktree.test.ts` / `adopt.test.ts` — the whole point is git's actual
 * surface (a real `git worktree add` then a real rollback `remove`), so mocking
 * would only test the mock.
 *
 * The store is the one seam we fake: a thin subclass whose `update` can be made
 * to throw once (the write that records `worktreePath`) or to drop the task the
 * instant after a successful write (a concurrent delete). Both are the real
 * failure modes that strand an orphan worktree or surface a spurious
 * `TaskNotFoundError`.
 */

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { Orchestrator } from "../../src/orchestrator/core.ts"
import { TaskIndexStore } from "../../src/orchestrator/index/store.ts"
import { GitWorktreeManager } from "../../src/orchestrator/worktree/manager.ts"

const REPO_INIT = path.resolve(__dirname, "./fixtures/repo-init.sh")

/**
 * Store double: lets a test force the `worktreePath` write to fail once, or
 * have the task vanish right after a successful write (concurrent delete).
 */
class FlakyStore extends TaskIndexStore {
  failNextUpdate = false
  deleteAfterNextUpdate = false
  /** Leave an untracked file in the new worktree before failing the write. */
  dirtyWorktreeBeforeFailing = false

  override async update(id: string, patch: Partial<Parameters<TaskIndexStore["update"]>[1]>) {
    if (this.failNextUpdate) {
      this.failNextUpdate = false
      const created = (patch as { worktreePath?: string }).worktreePath
      if (this.dirtyWorktreeBeforeFailing && created) {
        fs.writeFileSync(path.join(created, "scratch.txt"), "left behind by the engine\n")
      }
      throw new Error("simulated store write failure")
    }
    const result = await super.update(id, patch as never)
    if (this.deleteAfterNextUpdate) {
      this.deleteAfterNextUpdate = false
      await super.remove(id)
    }
    return result
  }
}

let tmpRoot: string
let repo: string
let prevHome: string | undefined
let store: FlakyStore
let orch: Orchestrator

beforeEach(async () => {
  prevHome = process.env.KOBE_HOME_DIR
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kobe-ensure-wt-"))
  // The worktree manager computes paths under `$KOBE_HOME_DIR/.rove/worktrees`,
  // so isolate it (and the store) to the tmp home.
  const home = path.join(tmpRoot, "home")
  process.env.KOBE_HOME_DIR = home
  repo = path.join(tmpRoot, "repo")
  const r = spawnSync("bash", [REPO_INIT, repo], { encoding: "utf8" })
  if (r.status !== 0) throw new Error(`repo-init.sh failed: ${r.stderr}\n${r.stdout}`)
  store = new FlakyStore({ homeDir: home })
  await store.load()
  orch = new Orchestrator({ store, worktrees: new GitWorktreeManager() })
})

afterEach(() => {
  if (prevHome === undefined) Reflect.deleteProperty(process.env, "KOBE_HOME_DIR")
  else process.env.KOBE_HOME_DIR = prevHome
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  } catch {
    // ignored
  }
})

describe("ensureWorktree — happy path", () => {
  test("creates + records the worktree, idempotent on a second call", async () => {
    const task = await orch.createTask({ repo })
    const p = await orch.ensureWorktree(task.id)
    expect(p).toBeTruthy()
    expect(fs.existsSync(p)).toBe(true)
    expect(orch.getTask(task.id)?.worktreePath).toBe(p)

    // Second call short-circuits on the recorded path — same value, no new dir.
    expect(await orch.ensureWorktree(task.id)).toBe(p)
    expect((await new GitWorktreeManager().list(repo)).length).toBe(1)
  })

  test("concurrent calls dedupe to one worktree + the same path", async () => {
    const task = await orch.createTask({ repo })
    const [a, b] = await Promise.all([orch.ensureWorktree(task.id), orch.ensureWorktree(task.id)])
    expect(a).toBe(b)
    expect((await new GitWorktreeManager().list(repo)).length).toBe(1)
  })
})

describe("ensureWorktree — partial-failure cleanup (no orphans)", () => {
  test("a failed worktreePath write rolls back the just-created worktree + frees the slug", async () => {
    const task = await orch.createTask({ repo })
    store.failNextUpdate = true

    await expect(orch.ensureWorktree(task.id)).rejects.toThrow(/simulated store write failure/)

    // The task record never got a path (so it stays a lazy, retryable task)...
    expect(orch.getTask(task.id)?.worktreePath).toBe("")
    // ...and nothing was left on disk: no kobe-managed worktree, no orphan dir
    // under the worktrees root that a retry would collide with.
    expect(await new GitWorktreeManager().list(repo)).toEqual([])
  })

  test("a DIRTY worktree still rolls back — the rollback removal is forced", async () => {
    // Realistic: the engine's init script (or a baseRef checkout) already
    // wrote into the worktree by the time the store write fails. The rollback
    // must remove it anyway.
    //
    // Drop `{ force: true }` from `rollbackWorktree` (worktree-coordinator.ts
    // :212) and this goes red: `remove()` refuses a dirty worktree, the
    // rollback swallows that error into a console warning, and the directory
    // survives as debris a retry then collides with.
    const task = await orch.createTask({ repo })
    store.failNextUpdate = true
    store.dirtyWorktreeBeforeFailing = true

    await expect(orch.ensureWorktree(task.id)).rejects.toThrow(/simulated store write failure/)

    expect(await new GitWorktreeManager().list(repo)).toEqual([])
    expect(orch.getTask(task.id)?.worktreePath).toBe("")
  })

  test("retry after a failed write succeeds cleanly (operation is idempotent/retryable)", async () => {
    const task = await orch.createTask({ repo })
    store.failNextUpdate = true
    await expect(orch.ensureWorktree(task.id)).rejects.toThrow()

    // Second attempt: the store is healthy again. The previous attempt left no
    // debris, so this allocates fresh and persists with no "path exists but is
    // not a registered git worktree" collision.
    const p = await orch.ensureWorktree(task.id)
    expect(fs.existsSync(p)).toBe(true)
    expect(orch.getTask(task.id)?.worktreePath).toBe(p)
    const list = await new GitWorktreeManager().list(repo)
    expect(list.length).toBe(1)
    expect(list[0]?.path).toBe(p)
  })
})

describe("ensureWorktree — concurrent delete after a successful write", () => {
  test("returns the created path instead of throwing TaskNotFound", async () => {
    const task = await orch.createTask({ repo })
    // The write lands, then the task is dropped (a delete racing the window
    // between releasing the lock and a re-fetch). Re-fetching after the lock
    // would throw TaskNotFoundError; we return the path computed before
    // releasing the lock.
    store.deleteAfterNextUpdate = true

    const p = await orch.ensureWorktree(task.id)
    expect(p).toBeTruthy()
    expect(fs.existsSync(p)).toBe(true)
    // The task really is gone — proving we did NOT lean on a post-lock re-fetch.
    expect(orch.getTask(task.id)).toBeUndefined()
  })
})

describe("ensureWorktree — recorded baseRef (durable fork point)", () => {
  test("persists baseRef on the task and cuts from it even after a daemon restart", async () => {
    // Stage a side branch with a distinct commit, then move HEAD back to
    // main so the base choice is observable in the worktree's contents.
    spawnSync("git", ["checkout", "-q", "-b", "side-base"], { cwd: repo })
    fs.writeFileSync(path.join(repo, "SIDE.md"), "side\n")
    spawnSync("git", ["add", "SIDE.md"], { cwd: repo })
    spawnSync("git", ["commit", "-q", "-m", "side base"], { cwd: repo })
    const sideSha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).stdout.trim()
    spawnSync("git", ["checkout", "-q", "main"], { cwd: repo })

    const task = await orch.createTask({ repo, baseRef: "side-base" })
    // The fork point is durable Task state, not a one-shot in-memory side-map:
    // it must be ON the record — this is what lets a consumer compare against
    // the real fork point, and what survives a daemon restart before the
    // lazy worktree materialises.
    expect(orch.getTask(task.id)?.baseRef).toBe("side-base")

    // Simulated daemon restart: a brand-new Orchestrator over the SAME store
    // (an in-memory side-map would die with the "process"). The worktree must still
    // cut from side-base, not silently from the repo's current HEAD.
    const restarted = new Orchestrator({ store, worktrees: new GitWorktreeManager() })
    const p = await restarted.ensureWorktree(task.id)
    const ancestry = spawnSync("git", ["merge-base", "--is-ancestor", sideSha, "HEAD"], { cwd: p })
    expect(ancestry.status).toBe(0)
    expect(fs.existsSync(path.join(p, "SIDE.md"))).toBe(true)
  })
})
