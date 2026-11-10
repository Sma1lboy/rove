/**
 * `createTask({ forkFrom })`: a sibling whose worktree is a clone of the parent's, uncommitted work included.
 * Real git, real store; only the volume probe and the clone primitive are injected, because `cp -c` / reflink
 * need a clone-capable filesystem the CI runner may not have. The cloning itself is covered by the sandbox E2E.
 */

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { Orchestrator } from "../../src/orchestrator/core.ts"
import { FORK_UNSUPPORTED_CODE } from "../../src/orchestrator/errors.ts"
import { TaskIndexStore } from "../../src/orchestrator/index/store.ts"
import { createWorkspaceRegistry } from "../../src/orchestrator/workspace/index.ts"
import { GitWorktreeManager } from "../../src/orchestrator/worktree/manager.ts"

const REPO_INIT = path.resolve(__dirname, "./fixtures/repo-init.sh")

const git = (cwd: string, ...args: string[]): string => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" })
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`)
  return r.stdout.trim()
}

/** A plain recursive copy standing in for `cp -c`: same file set, no filesystem support needed. */
const copyEntries = async (entries: readonly string[], to: string): Promise<void> => {
  for (const entry of entries) {
    await fs.promises.cp(entry, path.join(to, path.basename(entry)), { recursive: true, verbatimSymlinks: true })
  }
}

let tmpRoot: string
let repo: string
let prevHome: string | undefined
let store: TaskIndexStore

function orchestratorWith(canClone: boolean, cloneEntries = copyEntries): Orchestrator {
  const worktrees = new GitWorktreeManager()
  const workspaces = createWorkspaceRegistry(worktrees, { probe: async () => canClone, cloneEntries })
  return new Orchestrator({ store, worktrees, workspaces })
}

beforeEach(async () => {
  prevHome = process.env.ROVE_HOME_DIR
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rove-fork-task-"))
  const home = path.join(tmpRoot, "home")
  process.env.ROVE_HOME_DIR = home
  repo = path.join(tmpRoot, "repo")
  const r = spawnSync("bash", [REPO_INIT, repo], { encoding: "utf8" })
  if (r.status !== 0) throw new Error(`repo-init.sh failed: ${r.stderr}\n${r.stdout}`)
  fs.writeFileSync(path.join(repo, ".gitignore"), "node_modules/\n")
  git(repo, "add", ".gitignore")
  git(repo, "commit", "-q", "-m", "ignore node_modules")
  store = new TaskIndexStore({ homeDir: home })
  await store.load()
})

afterEach(() => {
  if (prevHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = prevHome
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

/** A materialised parent with one of each kind of uncommitted state. */
async function dirtyParent(orch: Orchestrator) {
  const parent = await orch.createTask({ repo, title: "parent work" })
  const dir = await orch.ensureWorktree(parent.id)
  fs.appendFileSync(path.join(dir, "README.md"), "edited, not committed\n")
  fs.writeFileSync(path.join(dir, "staged.txt"), "staged\n")
  git(dir, "add", "staged.txt")
  fs.writeFileSync(path.join(dir, "untracked.txt"), "untracked\n")
  fs.mkdirSync(path.join(dir, "node_modules/dep"), { recursive: true })
  fs.writeFileSync(path.join(dir, "node_modules/dep/index.js"), "module.exports = 1\n")
  return { parent, dir }
}

describe("fork with uncommitted state", () => {
  test("carries the edit, the staged file, the untracked file and the ignored dir; leaves the parent alone", async () => {
    const orch = orchestratorWith(true)
    const { parent, dir } = await dirtyParent(orch)
    const parentStatus = git(dir, "status", "--porcelain")

    const child = await orch.createTask({ repo, forkFrom: parent.id })

    expect(child.worktreePath).not.toBe("")
    expect(child.worktreePath).not.toBe(dir)
    expect(child.title).toBe("parent work (fork)")
    expect(child.workspace).toEqual({ backend: "cow-clone", ref: String(parent.id) })
    expect(fs.readFileSync(path.join(child.worktreePath, "README.md"), "utf8")).toContain("edited, not committed")
    expect(fs.readFileSync(path.join(child.worktreePath, "untracked.txt"), "utf8")).toBe("untracked\n")
    expect(fs.existsSync(path.join(child.worktreePath, "node_modules/dep/index.js"))).toBe(true)
    // Staged stays staged, and the edit stays unstaged: status reads the same as the parent's.
    expect(git(child.worktreePath, "diff", "--cached", "--name-only")).toBe("staged.txt")
    expect(git(child.worktreePath, "status", "--porcelain")).toBe(parentStatus)

    expect(child.branch).not.toBe(parent.branch)
    expect(git(child.worktreePath, "rev-parse", "--abbrev-ref", "HEAD")).toBe(child.branch)
    expect(git(child.worktreePath, "rev-parse", "HEAD")).toBe(git(dir, "rev-parse", "HEAD"))
    expect(git(dir, "status", "--porcelain")).toBe(parentStatus)
    expect(git(dir, "rev-parse", "--abbrev-ref", "HEAD")).toBe(store.get(parent.id)?.branch)
  })

  test("a fork's own edits never reach the parent", async () => {
    const orch = orchestratorWith(true)
    const { parent, dir } = await dirtyParent(orch)
    const child = await orch.createTask({ repo, forkFrom: parent.id })

    fs.writeFileSync(path.join(child.worktreePath, "untracked.txt"), "changed in the fork\n")

    expect(fs.readFileSync(path.join(dir, "untracked.txt"), "utf8")).toBe("untracked\n")
    expect(store.get(parent.id)?.workspace).toBeUndefined()
  })

  test("a fork that vanished comes back as a plain worktree on its own branch, not a re-clone of the parent", async () => {
    const orch = orchestratorWith(true)
    const { parent } = await dirtyParent(orch)
    const child = await orch.createTask({ repo, forkFrom: parent.id })
    fs.rmSync(child.worktreePath, { recursive: true, force: true })

    const back = await orch.ensureWorktree(child.id)

    expect(git(back, "rev-parse", "--abbrev-ref", "HEAD")).toBe(child.branch)
    expect(fs.existsSync(path.join(back, "untracked.txt"))).toBe(false)
  })
})

describe("fork refusals", () => {
  test("a volume that cannot clone refuses before anything is created", async () => {
    const orch = orchestratorWith(false)
    const { parent, dir } = await dirtyParent(orch)
    const rows = store.list().length
    const branches = git(repo, "branch", "--list")

    await expect(orch.createTask({ repo, forkFrom: parent.id })).rejects.toThrow(FORK_UNSUPPORTED_CODE)

    expect(store.list()).toHaveLength(rows)
    expect(git(repo, "branch", "--list")).toBe(branches)
    expect(git(dir, "status", "--porcelain")).toContain("untracked.txt")
  })

  test("a clone that dies after the worktree was added leaves no worktree, branch or row, and the name is reusable", async () => {
    let fail = true
    const orch = orchestratorWith(true, async (entries, to) => {
      if (fail) throw new Error("cloning the worktree failed: disk full")
      await copyEntries(entries, to)
    })
    const { parent, dir } = await dirtyParent(orch)
    const rows = store.list().length
    const branches = git(repo, "branch", "--list")
    const worktrees = git(repo, "worktree", "list")

    await expect(orch.createTask({ repo, forkFrom: parent.id })).rejects.toThrow("disk full")

    expect(store.list()).toHaveLength(rows)
    expect(git(repo, "branch", "--list")).toBe(branches)
    expect(git(repo, "worktree", "list")).toBe(worktrees)
    expect(fs.readdirSync(path.dirname(dir))).toEqual([path.basename(dir)])

    fail = false
    const retry = await orch.createTask({ repo, forkFrom: parent.id })
    expect(fs.existsSync(path.join(retry.worktreePath, "untracked.txt"))).toBe(true)
  })

  test("a plain enter that wins the race against the clone fails the fork instead of silently dropping the edits", async () => {
    const orch = orchestratorWith(true)
    const { parent, dir } = await dirtyParent(orch)
    const rows = store.list().length
    const branches = git(repo, "branch", "--list")
    // Something (another client) enters the child the moment its row appears.
    const unsubscribe = store.subscribe((tasks) => {
      const child = tasks.find((t) => t.workspace?.backend === "cow-clone")
      if (child) void orch.ensureWorktree(child.id).catch(() => {})
    })

    await expect(orch.createTask({ repo, forkFrom: parent.id })).rejects.toThrow(FORK_UNSUPPORTED_CODE)
    unsubscribe()

    expect(store.list()).toHaveLength(rows)
    expect(git(repo, "branch", "--list")).toBe(branches)
    expect(fs.readdirSync(path.dirname(dir))).toEqual([path.basename(dir)])
  })

  test("a project's main checkout has no Rove worktree to clone", async () => {
    const orch = orchestratorWith(true)
    const main = await orch.ensureMainTask(repo)

    await expect(orch.createTask({ repo, forkFrom: main.id })).rejects.toThrow(FORK_UNSUPPORTED_CODE)
  })

  test("a multi-repo task cannot be forked", async () => {
    const orch = orchestratorWith(true)
    const other = path.join(tmpRoot, "other")
    const r = spawnSync("bash", [REPO_INIT, other], { encoding: "utf8" })
    expect(r.status).toBe(0)
    const parent = await orch.createTask({ repo, extraRepos: [{ repo: other }] })

    await expect(orch.createTask({ repo, forkFrom: parent.id })).rejects.toThrow(FORK_UNSUPPORTED_CODE)
  })
})
