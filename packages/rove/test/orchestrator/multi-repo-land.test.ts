/**
 * Landing and syncing a task that spans several repos, end to end through the
 * Orchestrator with real git: every repo is probed before anything merges, the
 * merge order is the picked order, the first conflict stops the run with earlier
 * repos landed, and a re-run resumes.
 */

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { syncRepos } from "../../../rove-daemon/src/daemon/sync-repos.ts"
import { Orchestrator } from "../../src/orchestrator/core.ts"
import { EmptyBranchError } from "../../src/orchestrator/errors.ts"
import { TaskIndexStore } from "../../src/orchestrator/index/store.ts"
import { GitWorktreeManager } from "../../src/orchestrator/worktree/manager.ts"
import type { Task } from "../../src/types/task.ts"

const REPO_INIT = path.resolve(__dirname, "./fixtures/repo-init.sh")

let tmpRoot: string
let prevHome: string | undefined
let orch: Orchestrator
let torndown: string[]
let web: string
let api: string

function initRepo(name: string): string {
  const dir = path.join(tmpRoot, name)
  const r = spawnSync("bash", [REPO_INIT, dir], { encoding: "utf8" })
  if (r.status !== 0) throw new Error(`repo-init.sh failed: ${r.stderr}`)
  return fs.realpathSync(dir)
}

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" })
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`)
  return r.stdout.trim()
}

function commitFile(dir: string, file: string, content: string, message: string): void {
  fs.writeFileSync(path.join(dir, file), content)
  git(dir, "add", ".")
  git(dir, "commit", "-qm", message)
}

const worktreeCount = (repo: string) => git(repo, "worktree", "list", "--porcelain").split("\n\n").length

beforeEach(async () => {
  prevHome = process.env.ROVE_HOME_DIR
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rove-multi-land-"))
  const home = path.join(tmpRoot, "home")
  process.env.ROVE_HOME_DIR = home
  web = initRepo("web")
  api = initRepo("api")
  const store = new TaskIndexStore({ homeDir: home })
  await store.load()
  torndown = []
  orch = new Orchestrator({
    store,
    worktrees: new GitWorktreeManager(),
    tearDownSession: async (id) => {
      torndown.push(String(id))
    },
  })
})

afterEach(() => {
  orch.dispose()
  if (prevHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = prevHome
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

/** A two-repo task whose workers committed `web.txt` in web and `api.txt` in api. */
async function workedTask(): Promise<{ task: Task; webWt: string; apiWt: string }> {
  const created = await orch.createTask({ repo: web, title: "land both", extraRepos: [{ repo: api }] })
  const webWt = await orch.ensureWorktree(created.id)
  const task = orch.getTask(created.id) as Task
  const apiWt = task.extraRepos?.[0]?.worktreePath ?? ""
  commitFile(webWt, "web.txt", "w\n", "web work")
  commitFile(apiWt, "api.txt", "a\n", "api work")
  return { task, webWt, apiWt }
}

describe("landing a multi-repo task", () => {
  test("merges every repo into its own base, then removes every worktree", async () => {
    const { task, webWt, apiWt } = await workedTask()

    const result = await orch.landTask(task.id)

    expect(result.stopped).toBeUndefined()
    expect(result.repos?.map((r) => [r.name, r.status])).toEqual([
      ["web", "landed"],
      ["api", "landed"],
    ])
    expect(fs.existsSync(path.join(web, "web.txt"))).toBe(true)
    expect(fs.existsSync(path.join(api, "api.txt"))).toBe(true)
    expect(fs.existsSync(webWt) || fs.existsSync(apiWt)).toBe(false)
    const row = orch.getTask(task.id)
    expect(row?.worktreePath).toBe("")
    expect(row?.extraRepos?.[0]?.worktreePath).toBe("")
  })

  test("one repo refusing merges nothing anywhere", async () => {
    const { task } = await workedTask()
    fs.writeFileSync(path.join(api, "dirty.txt"), "uncommitted base change")

    const result = await orch.landTask(task.id)

    expect(result.stopped).toMatchObject({ repo: "api", code: "MAIN_CHECKOUT_DIRTY" })
    expect(result.repos?.map((r) => r.status)).toEqual(["pending", "refused"])
    expect(fs.existsSync(path.join(web, "web.txt"))).toBe(false)
    expect(worktreeCount(web)).toBe(2)
  })

  test("a conflict in the second repo stops there with the first landed, and a re-run resumes", async () => {
    const { task, webWt, apiWt } = await workedTask()
    // `api`'s base moves the same file the worker changed.
    commitFile(apiWt, "clash.txt", "from the worker\n", "worker clash")
    commitFile(api, "clash.txt", "from main\n", "main clash")

    const first = await orch.landTask(task.id)

    expect(first.stopped).toMatchObject({ repo: "api", code: "LAND_CONFLICT" })
    expect(first.repos?.map((r) => r.status)).toEqual(["landed", "conflict"])
    expect(git(api, "status", "--porcelain")).toBe("")
    expect(fs.existsSync(path.join(web, "web.txt"))).toBe(true)
    // Nothing is removed while a repo is unlanded: the engine may still be fixing it.
    expect(fs.existsSync(webWt) && fs.existsSync(apiWt)).toBe(true)

    // Resolve in the worker's api worktree by merging the base into it.
    spawnSync("git", ["merge", "main"], { cwd: apiWt, encoding: "utf8" })
    fs.writeFileSync(path.join(apiWt, "clash.txt"), "resolved\n")
    git(apiWt, "add", ".")
    git(apiWt, "commit", "-qm", "resolve")

    const second = await orch.landTask(task.id)

    expect(second.stopped).toBeUndefined()
    expect(second.repos?.map((r) => r.status)).toEqual(["skipped", "landed"])
    expect(git(api, "show", "HEAD:clash.txt")).toBe("resolved")
    expect(fs.existsSync(webWt) || fs.existsSync(apiWt)).toBe(false)
  })

  test("a squash land resumes past the repo it already squashed", async () => {
    const { task, webWt, apiWt } = await workedTask()
    commitFile(apiWt, "clash.txt", "from the worker\n", "worker clash")
    commitFile(api, "clash.txt", "from main\n", "main clash")

    const first = await orch.landTask(task.id, { strategy: "squash" })
    expect(first.repos?.map((r) => r.status)).toEqual(["landed", "conflict"])

    spawnSync("git", ["merge", "main"], { cwd: apiWt, encoding: "utf8" })
    fs.writeFileSync(path.join(apiWt, "clash.txt"), "resolved\n")
    git(apiWt, "add", ".")
    git(apiWt, "commit", "-qm", "resolve")

    const second = await orch.landTask(task.id, { strategy: "squash" })

    expect(second.stopped).toBeUndefined()
    expect(second.repos?.map((r) => r.status)).toEqual(["skipped", "landed"])
    expect(git(api, "show", "HEAD:clash.txt")).toBe("resolved")
    expect(fs.existsSync(webWt) || fs.existsSync(apiWt)).toBe(false)
  })

  test("--repo lands just that repo and leaves the others alone", async () => {
    const { task, webWt } = await workedTask()

    const result = await orch.landTask(task.id, { repo: "api" })

    expect(result.repos?.map((r) => [r.name, r.status])).toEqual([["api", "landed"]])
    expect(fs.existsSync(path.join(api, "api.txt"))).toBe(true)
    expect(fs.existsSync(path.join(web, "web.txt"))).toBe(false)
    expect(fs.existsSync(webWt)).toBe(true)
    await expect(orch.landTask(task.id, { repo: "nope" })).rejects.toThrow(/UNKNOWN_REPO.*web, api/)
  })

  test("landing the primary alone keeps its worktree and session while another repo is open", async () => {
    const { task, webWt, apiWt } = await workedTask()

    const result = await orch.landTask(task.id, { repo: "web", deleteBranch: true })

    expect(result.repos?.[0]).toMatchObject({ name: "web", status: "landed", worktree: { removed: false } })
    expect(result.repos?.[0]?.worktree?.reason).toContain("every repo has landed")
    expect(result.repos?.[0]?.branchKept).toBeDefined()
    expect(fs.existsSync(webWt) && fs.existsSync(apiWt)).toBe(true)
    expect(torndown).toEqual([])

    // Landing an extra afterwards removes only that extra; the engine's directory stays.
    await orch.landTask(task.id, { repo: "api" })
    expect(torndown).toEqual([])
    expect(fs.existsSync(apiWt)).toBe(false)
    expect(fs.existsSync(webWt)).toBe(true)
  })

  test("a repo landed and removed with --delete-branch reads as already landed, so the rest can still land", async () => {
    const { task, webWt } = await workedTask()
    await orch.landTask(task.id, { repo: "api", deleteBranch: true })
    expect(git(api, "branch", "--list", task.extraRepos?.[0]?.branch ?? "")).toBe("")

    const pf = await orch.landPreflight(task.id)
    expect(pf.repos?.map((r) => [r.name, r.status])).toEqual([
      ["web", "ready"],
      ["api", "skipped"],
    ])
    expect(pf.repos?.[1]?.message).toContain("landed earlier")

    const result = await orch.landTask(task.id)

    expect(result.stopped).toBeUndefined()
    expect(result.repos?.map((r) => [r.name, r.status])).toEqual([
      ["web", "landed"],
      ["api", "skipped"],
    ])
    expect(fs.existsSync(path.join(web, "web.txt"))).toBe(true)
    expect(fs.existsSync(webWt)).toBe(false)
    expect(torndown).toEqual([String(task.id)])
  })

  test("a task with nothing ahead in any repo is refused like a one-repo task", async () => {
    const created = await orch.createTask({ repo: web, extraRepos: [{ repo: api }] })
    await orch.ensureWorktree(created.id)

    await expect(orch.landTask(created.id)).rejects.toThrow(EmptyBranchError)
  })

  test("the dry-run probe lists each repo, marking an already-landed one skipped", async () => {
    const { task } = await workedTask()
    await orch.landTask(task.id, { repo: "web", removeWorktree: false })

    const pf = await orch.landPreflight(task.id)

    expect(pf.repos?.map((r) => [r.name, r.status])).toEqual([
      ["web", "skipped"],
      ["api", "ready"],
    ])
    // The top level answers the one-repo question: the repo that would land.
    expect(pf.branch).toBe(task.extraRepos?.[0]?.branch)
    expect(pf.refusal).toBeUndefined()
  })
})

describe("syncing a multi-repo task", () => {
  test("a conflict in one repo does not stop the others and is reported by name", async () => {
    const { task } = await workedTask()
    const synced: string[] = []
    const runtime = {
      async syncWorktreeWithBase(worktreePath: string) {
        synced.push(worktreePath)
        if (worktreePath === task.worktreePath) throw new Error("SYNC_CONFLICT: a.txt")
        return { baseRef: "main", alreadyCurrent: false }
      },
    }

    const res = await syncRepos(runtime, orch.getTask(task.id) as Task)

    expect(synced).toHaveLength(2)
    expect(res.repos.map((r) => [r.name, r.ok, r.code])).toEqual([
      ["web", false, "SYNC_CONFLICT"],
      ["api", true, undefined],
    ])
    expect(res.alreadyCurrent).toBe(false)
  })
})
