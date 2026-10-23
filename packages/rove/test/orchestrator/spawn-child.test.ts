/**
 * `Orchestrator.spawnChildTask` against real git: where a child's directory
 * and base commit come from, per kind of parent. Only the pty/engine side is
 * absent; worktrees, branches and the task index are real.
 */

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { Orchestrator } from "../../src/orchestrator/core.ts"
import { TaskIndexStore } from "../../src/orchestrator/index/store.ts"
import { taskCwd } from "../../src/orchestrator/task-tree.ts"
import { GitWorktreeManager } from "../../src/orchestrator/worktree/manager.ts"
import type { Task } from "../../src/types/task.ts"

const REPO_INIT = path.resolve(__dirname, "./fixtures/repo-init.sh")

let tmpRoot: string
let repo: string
let prevHome: string | undefined
let store: TaskIndexStore
let orch: Orchestrator

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" })
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`)
  return r.stdout.trim()
}

function initRepo(dir: string): void {
  const r = spawnSync("bash", [REPO_INIT, dir], { encoding: "utf8" })
  if (r.status !== 0) throw new Error(`repo-init.sh failed: ${r.stderr}\n${r.stdout}`)
}

function commit(cwd: string, file: string): string {
  fs.writeFileSync(path.join(cwd, file), `${file}\n`)
  git(cwd, "add", file)
  git(cwd, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", file)
  return git(cwd, "rev-parse", "HEAD")
}

/** The project's main row, without the project-eligibility gate a tmp repo fails. */
function mainRow(): Promise<Task> {
  return store.create({
    repo,
    title: "main",
    branch: "",
    worktreePath: repo,
    status: "backlog",
    kind: "main",
    vendor: "claude",
  })
}

beforeEach(async () => {
  prevHome = process.env.ROVE_HOME_DIR
  tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rove-spawn-child-")))
  const home = path.join(tmpRoot, "home")
  process.env.ROVE_HOME_DIR = home
  repo = path.join(tmpRoot, "repo")
  initRepo(repo)
  store = new TaskIndexStore({ homeDir: home })
  await store.load()
  orch = new Orchestrator({ store, worktrees: new GitWorktreeManager() })
})

afterEach(() => {
  orch.dispose()
  if (prevHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = prevHome
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe("worktree children", () => {
  test("a main checkout's child branches from its HEAD, with its own directory", async () => {
    const parent = await mainRow()
    const tip = commit(repo, "after-init.txt")

    const { task, parentDirty } = await orch.spawnChildTask({ parentTaskId: parent.id, worktree: true })

    expect(task.parentTaskId).toBe(parent.id)
    expect(task.sharesWorkspaceOf).toBeUndefined()
    expect(task.kind).toBe("task")
    expect(task.worktreePath).not.toBe(repo)
    expect(git(task.worktreePath, "rev-parse", "HEAD")).toBe(tip)
    expect(parentDirty).toBe(false)
  })

  test("a managed parent's child starts at the parent's current branch tip, not main's", async () => {
    const parent = await orch.createTask({ repo, title: "parent", vendor: "claude" })
    const parentDir = await orch.ensureWorktree(parent.id)
    const tip = commit(parentDir, "parent-work.txt")

    const { task } = await orch.spawnChildTask({ parentTaskId: parent.id, worktree: true })

    expect(git(task.worktreePath, "rev-parse", "HEAD")).toBe(tip)
    expect(task.branch).not.toBe(orch.getTask(parent.id)?.branch)
  })

  test("reports uncommitted work in the parent without carrying it", async () => {
    const parent = await mainRow()
    fs.writeFileSync(path.join(repo, "wip.txt"), "uncommitted\n")

    const { task, parentDirty } = await orch.spawnChildTask({ parentTaskId: parent.id, worktree: true })

    expect(parentDirty).toBe(true)
    expect(fs.existsSync(path.join(task.worktreePath, "wip.txt"))).toBe(false)
  })

  test("a dir task in a git subdirectory gets a worktree at the toplevel and the same relative cwd", async () => {
    fs.mkdirSync(path.join(repo, "packages", "app"), { recursive: true })
    const parent = await orch.openDirectoryTask({ dir: path.join(repo, "packages", "app") })

    const { task } = await orch.spawnChildTask({ parentTaskId: parent.id, worktree: true })

    expect(task.cwdSubpath).toBe(path.join("packages", "app"))
    expect(git(task.worktreePath, "rev-parse", "--show-toplevel")).toBe(fs.realpathSync(task.worktreePath))
    expect(taskCwd(task)).toBe(path.join(task.worktreePath, "packages", "app"))
  })

  test("a dir task outside any git repo fails NOT_A_GIT_REPO instead of sharing its directory", async () => {
    const plain = path.join(tmpRoot, "plain")
    fs.mkdirSync(plain)
    const parent = await orch.openDirectoryTask({ dir: plain })

    await expect(orch.spawnChildTask({ parentTaskId: parent.id, worktree: true })).rejects.toThrow(/NOT_A_GIT_REPO/)
    expect(store.list().filter((t) => t.parentTaskId === parent.id)).toEqual([])
  })
})

describe("a worktree child whose checkout cannot be recorded", () => {
  test("leaves no row, directory or branch behind", async () => {
    const parent = await mainRow()
    const branchesBefore = git(repo, "branch", "--list")
    const update = store.update.bind(store)
    vi.spyOn(store, "update").mockImplementation((id, patch) => {
      if ("worktreePath" in patch && patch.worktreePath) return Promise.reject(new Error("disk full"))
      return update(id, patch)
    })

    await expect(orch.spawnChildTask({ parentTaskId: parent.id, worktree: true })).rejects.toThrow("disk full")

    expect(store.list().filter((t) => t.parentTaskId === parent.id)).toEqual([])
    expect(git(repo, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1)
    expect(git(repo, "branch", "--list")).toBe(branchesBefore)
  })
})

describe("shared children", () => {
  test("a child of main shares the checkout as a dir row that is not the project row", async () => {
    const parent = await mainRow()

    const { task } = await orch.spawnChildTask({ parentTaskId: parent.id, worktree: false })

    expect(task.kind).toBe("dir")
    expect(task.sharesWorkspaceOf).toBe(parent.id)
    expect(task.worktreePath).toBe(repo)
    expect(task.parentTaskId).toBe(parent.id)
  })

  test("a child of a managed task shares its worktree and branch", async () => {
    const parent = await orch.createTask({ repo, title: "parent", vendor: "claude" })
    const parentDir = await orch.ensureWorktree(parent.id)

    const { task } = await orch.spawnChildTask({ parentTaskId: parent.id, worktree: false })

    expect(task.kind).toBe("task")
    expect(task.worktreePath).toBe(parentDir)
    expect(task.branch).toBe(orch.getTask(parent.id)?.branch)
    expect(task.sharesWorkspaceOf).toBe(parent.id)
  })

  test("a grandchild shares the directory's owner, not the sharer it was spawned from", async () => {
    const owner = await mainRow()
    const { task: child } = await orch.spawnChildTask({ parentTaskId: owner.id, worktree: false })

    const { task: grandchild } = await orch.spawnChildTask({ parentTaskId: child.id, worktree: false })

    expect(grandchild.parentTaskId).toBe(child.id)
    expect(grandchild.sharesWorkspaceOf).toBe(owner.id)
  })

  test("a shared child on a repo root is never promoted to, or adopted as, the project row", async () => {
    const parent = await orch.openDirectoryTask({ dir: repo })
    await orch.spawnChildTask({ parentTaskId: parent.id, worktree: false })

    await orch.init()

    const rows = store.list()
    expect(rows.filter((t) => t.kind === "main")).toHaveLength(1)
    expect(rows.find((t) => t.sharesWorkspaceOf)?.kind).toBe("dir")
  })
})

describe("symlinked repos in the parent workspace", () => {
  let linked: string
  let parent: Task
  let parentDir: string

  beforeEach(async () => {
    linked = path.join(tmpRoot, "linked-repo")
    initRepo(linked)
    parent = await orch.createTask({ repo, title: "parent", vendor: "claude" })
    parentDir = await orch.ensureWorktree(parent.id)
    fs.symlinkSync(linked, path.join(parentDir, "linked"))
    // A symlink to a plain directory is not a linked repo.
    fs.mkdirSync(path.join(tmpRoot, "plain"))
    fs.symlinkSync(path.join(tmpRoot, "plain"), path.join(parentDir, "plain-link"))
  })

  test("lists only top-level links to outside git checkouts, for a worktree child and a shared child", async () => {
    const worktreeChild = await orch.spawnChildTask({ parentTaskId: parent.id, worktree: true })
    const sharedChild = await orch.spawnChildTask({ parentTaskId: parent.id, worktree: false })

    expect(worktreeChild.sharedLinks).toEqual(["linked"])
    expect(sharedChild.sharedLinks).toEqual(["linked"])
  })

  test("--isolate-in cuts the worktree in the linked repo and reports nothing as shared", async () => {
    const { task, sharedLinks } = await orch.spawnChildTask({
      parentTaskId: parent.id,
      worktree: true,
      isolateIn: "linked",
    })

    expect(fs.realpathSync(task.repo)).toBe(fs.realpathSync(linked))
    expect(git(task.worktreePath, "rev-parse", "--git-common-dir")).toBe(path.join(fs.realpathSync(linked), ".git"))
    expect(sharedLinks).toEqual([])
  })

  test("--isolate-in naming anything else fails NOT_A_LINKED_REPO", async () => {
    for (const isolateIn of ["plain-link", "missing"]) {
      await expect(orch.spawnChildTask({ parentTaskId: parent.id, worktree: true, isolateIn })).rejects.toThrow(
        /NOT_A_LINKED_REPO/,
      )
    }
  })
})
