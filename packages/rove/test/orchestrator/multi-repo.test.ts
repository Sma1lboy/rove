/**
 * Multi-repo tasks end to end through the Orchestrator: real git, real store.
 * A task spans a primary repo plus extras; each repo gets its own worktree on
 * one shared branch name, creation is all-or-nothing, and delete covers every
 * repo or none.
 */

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { Orchestrator } from "../../src/orchestrator/core.ts"
import {
  DirtyWorktreeError,
  ExtraRepoNotGitError,
  RemoteExtraUnsupportedError,
  RepoDuplicateError,
  TooManyReposError,
  WorktreeRemoveFailedError,
} from "../../src/orchestrator/errors.ts"
import { normalizeIndex } from "../../src/orchestrator/index/store-codec.ts"
import { TaskIndexStore } from "../../src/orchestrator/index/store.ts"
import { GitWorktreeManager } from "../../src/orchestrator/worktree/manager.ts"
import type { Task } from "../../src/types/task.ts"

const REPO_INIT = path.resolve(__dirname, "./fixtures/repo-init.sh")

/** `update` can be made to fail once: the single write that records every checkout. */
class FlakyStore extends TaskIndexStore {
  failNextUpdate = false

  override async update(id: string, patch: Partial<Parameters<TaskIndexStore["update"]>[1]>) {
    if (this.failNextUpdate) {
      this.failNextUpdate = false
      throw new Error("simulated store write failure")
    }
    return super.update(id, patch as never)
  }
}

/** A manager whose `remove` fails once for one path, as a locked worktree does. */
class FlakyRemoveManager extends GitWorktreeManager {
  failPath: string | undefined

  override async remove(worktreePath: string, opts?: Parameters<GitWorktreeManager["remove"]>[1]) {
    if (this.failPath === worktreePath) {
      this.failPath = undefined
      throw new Error("simulated: worktree is locked")
    }
    return super.remove(worktreePath, opts)
  }
}

let tmpRoot: string
let prevHome: string | undefined
let store: FlakyStore
let manager: FlakyRemoveManager
let orch: Orchestrator
let salvaged: Array<{ ref: string; repo: string }>
let web: string
let api: string
let docs: string

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

/** Worktrees git knows in `repo`, main checkout included. */
const worktreeCount = (repo: string) => git(repo, "worktree", "list", "--porcelain").split("\n\n").length

const branches = (repo: string) => git(repo, "branch", "--format=%(refname:short)").split("\n").sort()

beforeEach(async () => {
  prevHome = process.env.ROVE_HOME_DIR
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rove-multi-repo-"))
  const home = path.join(tmpRoot, "home")
  process.env.ROVE_HOME_DIR = home
  web = initRepo("web")
  api = initRepo("api")
  docs = initRepo("docs")
  store = new FlakyStore({ homeDir: home })
  await store.load()
  manager = new FlakyRemoveManager()
  salvaged = []
  orch = new Orchestrator({
    store,
    worktrees: manager,
    onSalvage: (_taskId, record, repo) => salvaged.push({ ref: record.ref, repo }),
  })
})

afterEach(() => {
  orch.dispose()
  if (prevHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = prevHome
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

async function twoRepoTask(title = "span two repos"): Promise<{ task: Task; cwd: string; extraPath: string }> {
  const created = await orch.createTask({ repo: web, title, extraRepos: [{ repo: api }] })
  const cwd = await orch.ensureWorktree(created.id)
  const task = orch.getTask(created.id) as Task
  return { task, cwd, extraPath: task.extraRepos?.[0]?.worktreePath ?? "" }
}

describe("creating a multi-repo task", () => {
  test("cuts a worktree in every repo on one branch name", async () => {
    const { task, cwd, extraPath } = await twoRepoTask()

    expect(task.extraRepos).toEqual([{ name: "api", repo: api, branch: task.branch, worktreePath: extraPath }])
    expect(cwd).not.toBe(extraPath)
    for (const dir of [cwd, extraPath]) {
      expect(fs.existsSync(dir)).toBe(true)
      expect(git(dir, "branch", "--show-current")).toBe(task.branch)
    }
    // Idempotent: a second enter neither moves nor duplicates anything.
    expect(await orch.ensureWorktree(task.id)).toBe(cwd)
    expect(worktreeCount(web)).toBe(2)
    expect(worktreeCount(api)).toBe(2)
  })

  test("suffixes the shared branch only in the repo where the name is taken", async () => {
    const first = await twoRepoTask("same title")
    // Make the name the next task will derive for `web` already exist in `api` only.
    git(api, "branch", `${first.task.branch}-2`)

    const second = await twoRepoTask("same title")

    expect(second.task.branch).toBe(`${first.task.branch}-2`)
    expect(second.task.extraRepos?.[0]?.branch).toBe(`${first.task.branch}-2-2`)
    expect(git(second.extraPath, "branch", "--show-current")).toBe(`${first.task.branch}-2-2`)
  })

  test("a failing extra deletes a caller-named branch it cut in the primary, and keeps one that already existed", async () => {
    // `api` already has `shared` checked out, so its `worktree add` of the same branch fails.
    git(api, "checkout", "-q", "-b", "shared")
    git(web, "branch", "kept")
    const fresh = await orch.createTask({ repo: web, branch: "shared", extraRepos: [{ repo: api }] })

    await expect(orch.ensureWorktree(fresh.id)).rejects.toThrow()

    expect(branches(web)).toEqual(["kept", "main"])
    expect(worktreeCount(web)).toBe(1)

    git(api, "checkout", "-q", "main")
    git(api, "checkout", "-q", "-b", "kept")
    const existing = await orch.createTask({ repo: web, branch: "kept", extraRepos: [{ repo: api }] })
    await expect(orch.ensureWorktree(existing.id)).rejects.toThrow()

    expect(branches(web)).toContain("kept")
  })

  test("renaming the branch renames it in every repo that shares the name", async () => {
    const { task, cwd, extraPath } = await twoRepoTask()

    await orch.setBranch(task.id, "feat/renamed")

    const row = orch.getTask(task.id)
    expect(row?.branch).toBe("feat/renamed")
    expect(row?.extraRepos?.[0]?.branch).toBe("feat/renamed")
    for (const dir of [cwd, extraPath]) expect(git(dir, "branch", "--show-current")).toBe("feat/renamed")
  })

  test("takes each extra's own base ref", async () => {
    git(api, "branch", "release", "main")
    fs.writeFileSync(path.join(api, "only-on-release.txt"), "x")
    git(api, "checkout", "-q", "release")
    git(api, "add", ".")
    git(api, "commit", "-qm", "release only")
    git(api, "checkout", "-q", "main")

    const created = await orch.createTask({ repo: web, extraRepos: [{ repo: api, baseRef: "release" }] })
    await orch.ensureWorktree(created.id)
    const extra = orch.getTask(created.id)?.extraRepos?.[0]

    expect(fs.existsSync(path.join(extra?.worktreePath ?? "", "only-on-release.txt"))).toBe(true)
  })

  test("a failing extra removes the primary and the extras already cut", async () => {
    const created = await orch.createTask({ repo: web, extraRepos: [{ repo: api }, { repo: docs }] })
    // `docs` stops being a repo after the task was created: its `worktree add` fails last.
    fs.rmSync(path.join(docs, ".git"), { recursive: true, force: true })

    await expect(orch.ensureWorktree(created.id)).rejects.toThrow()

    for (const repo of [web, api]) {
      expect(worktreeCount(repo)).toBe(1)
      expect(branches(repo)).toEqual(["main"])
    }
    const row = orch.getTask(created.id)
    expect(row?.worktreePath).toBe("")
    expect(row?.extraRepos?.map((e) => e.worktreePath)).toEqual(["", ""])
  })

  test("a failed index write leaves no worktree or branch in any repo", async () => {
    const created = await orch.createTask({ repo: web, extraRepos: [{ repo: api }] })
    store.failNextUpdate = true

    await expect(orch.ensureWorktree(created.id)).rejects.toThrow("simulated store write failure")

    for (const repo of [web, api]) {
      expect(worktreeCount(repo)).toBe(1)
      expect(branches(repo)).toEqual(["main"])
    }
    // The task is still usable: the next enter cuts everything.
    await orch.ensureWorktree(created.id)
    expect(worktreeCount(api)).toBe(2)
  })

  test("re-cuts only the extra whose directory vanished, on its own branch", async () => {
    const { task, cwd, extraPath } = await twoRepoTask()
    git(api, "worktree", "remove", "--force", extraPath)

    expect(await orch.ensureWorktree(task.id)).toBe(cwd)

    const extra = orch.getTask(task.id)?.extraRepos?.[0]
    expect(extra?.branch).toBe(task.branch)
    expect(fs.existsSync(extra?.worktreePath ?? "")).toBe(true)
    expect(git(extra?.worktreePath ?? "", "branch", "--show-current")).toBe(task.branch)
  })

  test("an extra's worktree is not offered as an adoptable foreign worktree", async () => {
    await twoRepoTask()

    expect(await orch.discoverAdoptableWorktrees(api)).toEqual([])
  })

  test("refuses what a task cannot span, creating nothing", async () => {
    const plain = path.join(tmpRoot, "plain")
    fs.mkdirSync(plain)
    const sub = path.join(web, "pkg")
    fs.mkdirSync(sub)
    const many = Array.from({ length: 8 }, () => ({ repo: api }))

    await expect(orch.createTask({ repo: web, extraRepos: many })).rejects.toThrow(TooManyReposError)
    await expect(orch.createTask({ repo: web, extraRepos: [{ repo: api }, { repo: api }] })).rejects.toThrow(
      RepoDuplicateError,
    )
    // A subdirectory of the primary resolves to the primary's own root.
    await expect(orch.createTask({ repo: web, extraRepos: [{ repo: sub }] })).rejects.toThrow(RepoDuplicateError)
    await expect(orch.createTask({ repo: web, extraRepos: [{ repo: plain }] })).rejects.toThrow(ExtraRepoNotGitError)
    await expect(orch.createTask({ repo: web, extraRepos: [{ repo: "ssh://me@host/srv/api" }] })).rejects.toThrow(
      RemoteExtraUnsupportedError,
    )
    await expect(orch.createTask({ repo: "ssh://me@host/srv/web", extraRepos: [{ repo: api }] })).rejects.toThrow(
      RemoteExtraUnsupportedError,
    )
    expect(orch.listTasks().filter((t) => t.kind === "task")).toEqual([])
  })
})

describe("deleting a multi-repo task", () => {
  test("refuses while an extra is dirty, naming it, and marks nothing", async () => {
    const { task, cwd, extraPath } = await twoRepoTask()
    fs.writeFileSync(path.join(extraPath, "wip.txt"), "unsaved")

    const refusal = await orch.deleteTask(task.id).catch((err: unknown) => err)

    expect(refusal).toBeInstanceOf(DirtyWorktreeError)
    expect((refusal as Error).message).toContain("(api)")
    expect(orch.getTask(task.id)?.deletion).toBeUndefined()
    expect(fs.existsSync(cwd) && fs.existsSync(extraPath)).toBe(true)
  })

  test("names every dirty repo in one refusal", async () => {
    const { task, cwd, extraPath } = await twoRepoTask()
    fs.writeFileSync(path.join(cwd, "a.txt"), "x")
    fs.writeFileSync(path.join(extraPath, "b.txt"), "y")

    const refusal = await orch.deleteTask(task.id).catch((err: unknown) => err)

    expect((refusal as Error).message).toMatch(/\(web\).*also api/)
  })

  test("removes every worktree when all are clean, keeping the branches", async () => {
    const { task, cwd, extraPath } = await twoRepoTask()

    await orch.deleteTask(task.id)

    expect(orch.getTask(task.id)).toBeUndefined()
    expect(fs.existsSync(cwd) || fs.existsSync(extraPath)).toBe(false)
    expect(worktreeCount(web) + worktreeCount(api)).toBe(2)
    expect(branches(api)).toContain(task.branch)
  })

  test("a forced delete salvages dirty work in each repo it came from", async () => {
    const { task, cwd, extraPath } = await twoRepoTask()
    fs.writeFileSync(path.join(cwd, "a.txt"), "x")
    fs.writeFileSync(path.join(extraPath, "b.txt"), "y")

    await orch.deleteTask(task.id, { force: true })

    expect(salvaged.map((s) => s.repo).sort()).toEqual([api, web].sort())
    for (const { ref, repo } of salvaged) expect(git(repo, "rev-parse", "--verify", ref)).toMatch(/^[0-9a-f]{40}$/)
    expect(fs.existsSync(extraPath)).toBe(false)
  })

  test("deleteBranch removes the shared branch from every repo", async () => {
    const { task } = await twoRepoTask()

    await orch.deleteTask(task.id, { deleteBranch: true })

    expect(branches(web)).toEqual(["main"])
    expect(branches(api)).toEqual(["main"])
  })

  test("a retry after an extra failed to come off finishes the deletion", async () => {
    const { task, cwd, extraPath } = await twoRepoTask()
    manager.failPath = extraPath

    await expect(orch.deleteTask(task.id)).rejects.toThrow(WorktreeRemoveFailedError)
    const stuck = orch.getTask(task.id)
    expect(stuck?.deletion?.phase).toBe("error")
    expect(stuck?.deletion?.error).toContain("api")
    expect(fs.existsSync(cwd)).toBe(false)
    expect(fs.existsSync(extraPath)).toBe(true)

    await orch.deleteTask(task.id)

    expect(orch.getTask(task.id)).toBeUndefined()
    expect(fs.existsSync(extraPath)).toBe(false)
  })

  test("a sharer that outlives its owner inherits the extras, which stay on disk", async () => {
    const { task, cwd, extraPath } = await twoRepoTask()
    const sharer = await store.create({
      repo: web,
      title: "shared child",
      branch: task.branch,
      worktreePath: cwd,
      status: "backlog",
      kind: "task",
      vendor: "claude",
      sharesWorkspaceOf: task.id,
    })

    await orch.deleteTask(task.id)

    const heir = orch.getTask(sharer.id)
    expect(heir?.extraRepos?.map((e) => e.worktreePath)).toEqual([extraPath])
    expect(fs.existsSync(extraPath)).toBe(true)

    await orch.deleteTask(sharer.id)
    expect(fs.existsSync(extraPath)).toBe(false)
  })
})

describe("tasks.json codec for extraRepos", () => {
  const row = (extra: unknown): unknown => ({
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    title: "t",
    repo: "/work/web",
    branch: "b",
    worktreePath: "",
    status: "backlog",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...(extra === undefined ? {} : { extraRepos: extra }),
  })
  const load = (extra: unknown) => normalizeIndex({ version: 3, tasks: [row(extra)] }, "codec-test").tasks

  test("a row written before the field existed loads with no extras", () => {
    const [loaded] = load(undefined)
    expect(loaded?.title).toBe("t")
    expect(loaded && "extraRepos" in loaded).toBe(false)
  })

  test("a bad entry is dropped without losing the row or its good siblings", () => {
    const good = { name: "api", repo: "/work/api", branch: "b", worktreePath: "" }
    const [loaded] = load([
      good,
      { ...good, repo: "/work/other" }, // duplicate name
      { name: "x", repo: "/work/api" }, // duplicate root
      { name: "rel", repo: "relative/path" },
      { name: "../escape", repo: "/work/esc" },
      { name: "web", repo: "/work/web" }, // the primary again
      "garbage",
    ])
    expect(loaded?.extraRepos).toEqual([good])
  })

  test("entries past the cap are dropped", () => {
    const extras = Array.from({ length: 12 }, (_, i) => ({
      name: `r${i}`,
      repo: `/work/r${i}`,
      branch: "",
      worktreePath: "",
    }))
    expect(load(extras)[0]?.extraRepos).toHaveLength(7)
  })
})
