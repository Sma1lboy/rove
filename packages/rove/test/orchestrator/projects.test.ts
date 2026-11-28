import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Orchestrator } from "@sma1lboy/rove-core/orchestrator/core.ts"
import { TaskIndexStore } from "@sma1lboy/rove-core/orchestrator/index/store.ts"
import { GitWorktreeManager } from "@sma1lboy/rove-core/orchestrator/worktree/manager.ts"
import { getSavedRepos } from "@sma1lboy/rove-core/state/repos.ts"
import type { Task } from "@sma1lboy/rove-core/types/task.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"

const REPO_INIT = path.resolve(__dirname, "./fixtures/repo-init.sh")

let tmpRoot: string
let repo: string
let orch: Orchestrator
let store: TaskIndexStore
let originalHome: string | undefined

function initRepo(dir: string): void {
  const r = spawnSync("bash", [REPO_INIT, dir], { encoding: "utf8" })
  if (r.status !== 0) throw new Error(`repo-init.sh failed: ${r.stderr}\n${r.stdout}`)
}

beforeEach(async () => {
  // realpath: macOS tmpdir is a symlink, and savedRepos stores the resolved checkout.
  tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rove-projects-")))
  repo = path.join(tmpRoot, "repo")
  initRepo(repo)
  // Isolate state.json (savedRepos) from the developer's real one.
  originalHome = process.env.ROVE_HOME_DIR
  process.env.ROVE_HOME_DIR = path.join(tmpRoot, "home")
  store = new TaskIndexStore({ homeDir: path.join(tmpRoot, "home") })
  await store.load()
  orch = new Orchestrator({ store, worktrees: new GitWorktreeManager() })
})

afterEach(() => {
  // biome-ignore lint/performance/noDelete: assigning undefined would leave the string "undefined".
  if (originalHome === undefined) delete process.env.ROVE_HOME_DIR
  else process.env.ROVE_HOME_DIR = originalHome
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe("ensureProject", () => {
  test("saves the repo once and returns its root, from a subdirectory too", async () => {
    const sub = path.join(repo, "packages", "app")
    fs.mkdirSync(sub, { recursive: true })

    expect(await orch.ensureProject(sub)).toBe(repo)
    expect(await orch.ensureProject(repo)).toBe(repo)

    expect(getSavedRepos().filter((r) => r === repo)).toHaveLength(1)
    expect(orch.listTasks()).toHaveLength(0)
  })

  test("throws for an ineligible repo, naming the reason", async () => {
    const sandboxed = path.join(tmpRoot, ".dev-sandbox", "explicit-repo")
    initRepo(sandboxed)

    await expect(orch.ensureProject(sandboxed)).rejects.toThrow(/sandbox or scratch/)
    expect(getSavedRepos()).not.toContain(sandboxed)
  })

  test("createTask saves its repo as a project, but not an ineligible one", async () => {
    const sandboxed = path.join(tmpRoot, ".dev-sandbox", "fixture-repo")
    initRepo(sandboxed)

    await orch.createTask({ repo, title: "t" })
    const fixture = await orch.createTask({ repo: sandboxed, title: "fixture" })

    expect(getSavedRepos()).toContain(repo)
    expect(getSavedRepos()).not.toContain(sandboxed)
    expect(orch.getTask(fixture.id)).toBeTruthy()
  })
})

describe("forgetProject", () => {
  test("un-saves the repo (matched from a subdirectory) and leaves its tasks", async () => {
    const sub = path.join(repo, "packages", "x")
    fs.mkdirSync(sub, { recursive: true })
    await orch.ensureProject(repo)
    const task = await orch.createTask({ repo, title: "work", vendor: "claude" })

    await orch.forgetProject(sub)

    expect(getSavedRepos()).not.toContain(repo)
    expect(orch.getTask(task.id)?.id).toBe(task.id)
  })
})

describe("settleProjectRows", () => {
  const formerProjectRow = (title: string, extra: Partial<Task> = {}) =>
    store.create({
      kind: "dir",
      fromProjectRow: true,
      title,
      repo,
      branch: "",
      worktreePath: repo,
      status: "backlog",
      ...extra,
    })

  test("drops a former project row holding nothing; one with a tab, a child or archived stays as a session", async () => {
    const empty = await formerProjectRow("empty")
    const tabbed = await formerProjectRow("tabbed")
    const parent = await formerProjectRow("parent")
    const archived = await formerProjectRow("archived", { archived: true })
    const kid = await orch.openDirectoryTask({ dir: repo, title: "kid" })
    await store.update(kid.id, { parentTaskId: parent.id })

    await orch.settleProjectRows((id) => id === String(tabbed.id))

    expect(orch.getTask(empty.id)).toBeUndefined()
    expect([tabbed, parent, archived].map((t) => orch.getTask(t.id)?.fromProjectRow)).toEqual([
      undefined,
      undefined,
      undefined,
    ])
    expect([tabbed, parent, archived].map((t) => orch.getTask(t.id)?.id)).toEqual([tabbed.id, parent.id, archived.id])
    expect(getSavedRepos()).toContain(repo)
  })
})
