import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { Orchestrator } from "../../src/orchestrator/core.ts"
import { TaskIndexStore } from "../../src/orchestrator/index/store.ts"
import { GitWorktreeManager } from "../../src/orchestrator/worktree/manager.ts"
import { addSavedRepo, getSavedRepos } from "../../src/state/repos.ts"

const REPO_INIT = path.resolve(__dirname, "./fixtures/repo-init.sh")

let tmpRoot: string
let repo: string
let orch: Orchestrator
let store: TaskIndexStore
let originalHome: string | undefined

beforeEach(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kobe-main-task-"))
  repo = path.join(tmpRoot, "repo")
  const r = spawnSync("bash", [REPO_INIT, repo], { encoding: "utf8" })
  if (r.status !== 0) throw new Error(`repo-init.sh failed: ${r.stderr}\n${r.stdout}`)
  // Isolate the shared state.json (savedRepos) that forgetProject mutates so
  // tests never touch the developer's real ~/.config/rove.
  originalHome = process.env.KOBE_HOME_DIR
  process.env.KOBE_HOME_DIR = path.join(tmpRoot, "home")
  store = new TaskIndexStore({ homeDir: path.join(tmpRoot, "home") })
  await store.load()
  orch = new Orchestrator({ store, worktrees: new GitWorktreeManager() })
})

afterEach(() => {
  // biome-ignore lint/performance/noDelete: env cleanup must fully unset when the var was unset before the test (assigning undefined leaves the string "undefined").
  if (originalHome === undefined) delete process.env.KOBE_HOME_DIR
  else process.env.KOBE_HOME_DIR = originalHome
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  } catch {
    // ignored
  }
})

describe("ensureMainTask", () => {
  test("createTask auto-creates the repo's main row (the sidebar PROJECTS entry)", async () => {
    // Regression: `kobe add` / the new-task dialog on a brand-new repo used
    // to create only the task — no `kind:"main"` row, so the sidebar never
    // grew a PROJECTS entry for the repo (the tmux-era boot provisioned
    // mains; the daemon world must do it on every creation path).
    const task = await orch.createTask({ repo, title: "t" })
    const mains = orch.listTasks().filter((t) => t.kind === "main")
    expect(task.kind).toBe("task")
    expect(mains).toHaveLength(1)
    expect(mains[0]?.repo).toBe(repo)
    // Idempotent: a second create in the same repo adds no second main.
    await orch.createTask({ repo, title: "t2" })
    expect(orch.listTasks().filter((t) => t.kind === "main")).toHaveLength(1)
  })

  // `rove` run from a monorepo SUBDIRECTORY (`my-monorepo/packages/app`) used
  // to split the sidebar into two projects: `ensureMainTask` normalized to the
  // git toplevel, but the task record two lines below kept `input.repo` raw.
  // The sidebar groups by string comparison of `task.repo`, so the main row
  // keyed on `/my-monorepo` and the task on `/my-monorepo/packages/app` — a
  // ghost project named after a subdirectory, with its own worktree root
  // (worktreeRootFor hashes path.resolve(repo)). `rove add` and `rove api add`
  // already resolved to the toplevel; this closes the last entry point.
  test("a task created from a subdirectory is filed under the repo root, not a ghost project", async () => {
    const sub = path.join(repo, "packages", "app")
    fs.mkdirSync(sub, { recursive: true })

    const task = await orch.createTask({ repo: sub, title: "from-subdir" })

    // The subdirectory must not survive into the record at all.
    expect(task.repo).not.toBe(sub)
    expect(task.repo.endsWith(path.join("packages", "app"))).toBe(false)
    // One project row, not two: the sidebar groups by string comparison on
    // this exact field, so task and main agreeing IS the fix.
    const mains = orch.listTasks().filter((t) => t.kind === "main")
    expect(mains).toHaveLength(1)
    expect(task.repo).toBe(mains[0]?.repo)
    expect(new Set(orch.listTasks().map((t) => t.repo)).size).toBe(1)
  })

  test("promotes an existing directory task on the same root instead of adding a second row", async () => {
    // Both rows pin the SAME checkout, so minting a main beside a dir task
    // put two rows with the same diff under one project header — one labelled
    // by branch, one by path (owner report 2026-08-25, `~/i/quill-all`).
    const dir = await orch.openDirectoryTask({ dir: repo })
    await orch.createTask({ repo, title: "t" })
    const mains = orch.listTasks().filter((t) => t.kind === "main")
    expect(mains).toHaveLength(1)
    // Promoted in place: same id, so the session's terminal tabs come with it.
    expect(mains[0]?.id).toBe(dir.id)
    expect(orch.listTasks().filter((t) => t.kind === "dir")).toHaveLength(0)
  })

  test("never promotes a scratch row — it belongs to the Scratch bench", async () => {
    const scratch = await orch.openDirectoryTask({ dir: repo, scratch: true })
    await orch.createTask({ repo, title: "t" })
    expect(orch.getTask(scratch.id)?.kind).toBe("dir")
    expect(orch.listTasks().filter((t) => t.kind === "main" && t.id !== scratch.id)).toHaveLength(1)
  })

  test("dedupes repo-root and subdirectory inputs to one main task", async () => {
    const subdir = path.join(repo, "packages", "kobe")
    fs.mkdirSync(subdir, { recursive: true })

    const first = await orch.ensureMainTask(repo)
    const second = await orch.ensureMainTask(subdir)
    const mainRows = orch.listTasks().filter((t) => t.kind === "main")

    expect(second.id).toBe(first.id)
    expect(mainRows).toHaveLength(1)
    expect(mainRows[0]?.repo).toBe(first.repo)
  })

  test("dedupes concurrent equivalent repo inputs before either create settles", async () => {
    const subdir = path.join(repo, "src")
    fs.mkdirSync(subdir)

    const [first, second] = await Promise.all([orch.ensureMainTask(repo), orch.ensureMainTask(subdir)])

    expect(second.id).toBe(first.id)
    expect(orch.listTasks().filter((t) => t.kind === "main")).toHaveLength(1)
  })
})

describe("forgetProject", () => {
  test("un-saves the repo and drops its main row, keeping child tasks", async () => {
    addSavedRepo(repo)
    await orch.ensureMainTask(repo)
    const child = await orch.createTask({ repo, title: "work", vendor: "claude" })
    expect(getSavedRepos()).toContain(repo)
    expect(orch.listTasks().filter((t) => t.kind === "main")).toHaveLength(1)

    await orch.forgetProject(repo)

    expect(getSavedRepos()).not.toContain(repo)
    expect(orch.listTasks().filter((t) => t.kind === "main")).toHaveLength(0)
    // The repo dir and the real task under it survive — forget is non-destructive.
    expect(orch.getTask(child.id)?.id).toBe(child.id)
    expect(fs.existsSync(repo)).toBe(true)
  })

  test("matches a subdirectory input the same way addSavedRepo normalized it", async () => {
    const subdir = path.join(repo, "packages", "x")
    fs.mkdirSync(subdir, { recursive: true })
    addSavedRepo(repo)
    await orch.ensureMainTask(repo)

    await orch.forgetProject(subdir)

    expect(getSavedRepos()).not.toContain(repo)
    expect(orch.listTasks().filter((t) => t.kind === "main")).toHaveLength(0)
  })

  test("idempotent: forgetting a never-saved repo no-ops", async () => {
    await expect(orch.forgetProject(repo)).resolves.toBeUndefined()
    expect(orch.listTasks().filter((t) => t.kind === "main")).toHaveLength(0)
  })
})

describe("project admission (state/project-eligibility.ts)", () => {
  test("createTask makes the task but NOT a project row for an ineligible repo", async () => {
    // The leak this gate closes: four fixture paths became permanent sidebar
    // projects that neither `task.delete` (refuses main rows) nor `rove
    // remove` (refuses unsaved repos) could remove.
    const sandboxed = path.join(tmpRoot, ".dev-sandbox", "smoke-repo")
    const r = spawnSync("bash", [REPO_INIT, sandboxed], { encoding: "utf8" })
    if (r.status !== 0) throw new Error(`repo-init.sh failed: ${r.stderr}`)

    const task = await orch.createTask({ repo: sandboxed, title: "fixture work" })

    // The task exists and is usable — the gate withholds the PROJECT row only.
    expect(task.kind).toBe("task")
    expect(orch.getTask(task.id)).toBeTruthy()
    expect(orch.listTasks().filter((t) => t.kind === "main")).toHaveLength(0)
  })

  test("ensureMainTask throws for an ineligible repo, naming the reason", async () => {
    // `rove add` / `project.ensureMain` are explicit gestures: a silent no-op
    // would read as the command having done nothing.
    const sandboxed = path.join(tmpRoot, ".dev-sandbox", "explicit-repo")
    const r = spawnSync("bash", [REPO_INIT, sandboxed], { encoding: "utf8" })
    if (r.status !== 0) throw new Error(`repo-init.sh failed: ${r.stderr}`)

    await expect(orch.ensureMainTask(sandboxed)).rejects.toThrow(/sandbox or scratch/)
    expect(orch.listTasks().filter((t) => t.kind === "main")).toHaveLength(0)
  })

  test("an ALREADY-EXISTING project row keeps working after the gate lands", async () => {
    // The gate governs what may BECOME a project. Re-gating an existing row
    // would punish the user for rows we created before the rule existed.
    const sandboxed = path.join(tmpRoot, ".dev-sandbox", "legacy-repo")
    const r = spawnSync("bash", [REPO_INIT, sandboxed], { encoding: "utf8" })
    if (r.status !== 0) throw new Error(`repo-init.sh failed: ${r.stderr}`)
    // Simulate the pre-gate world: a main row that already exists on disk.
    await store.create({
      kind: "main",
      title: "legacy-repo",
      repo: sandboxed,
      branch: "",
      worktreePath: sandboxed,
      status: "backlog",
      vendor: "claude",
    })

    const task = await orch.createTask({ repo: sandboxed, title: "still works" })
    expect(task.kind).toBe("task")
    // Still exactly one main row — found, not re-created and not refused.
    expect(orch.listTasks().filter((t) => t.kind === "main")).toHaveLength(1)
    // And the existing row is RETURNED, not merely left alone: the lookup has
    // to happen BEFORE the gate. With the two reordered, an ineligible repo
    // returns null here and every caller that relies on the row (the repo
    // path `createTask` normalizes through it) silently loses it.
    const found = await orch.ensureMainTask(sandboxed)
    expect(found.repo).toBe(sandboxed)
    expect(found.kind).toBe("main")
  })
})

describe("a project row and a saved-repos entry are the same fact", () => {
  test("ensureMainTask saves the repo, so the sidebar and the picker agree", async () => {
    // They used to be written by separate paths: a row minted by createTask
    // was a project you could SEE but not pick. Once closing the last tab
    // hides such a project, that gap loses it with no way back.
    expect(getSavedRepos()).not.toContain(repo)
    await orch.ensureMainTask(repo)
    expect(getSavedRepos()).toContain(repo)
  })

  test("createTask on a fresh repo saves it too", async () => {
    await orch.createTask({ repo, title: "t" })
    expect(getSavedRepos()).toContain(repo)
  })

  test("an ineligible repo is saved by neither", async () => {
    const sandboxed = path.join(tmpRoot, ".dev-sandbox", "paired-repo")
    const r = spawnSync("bash", [REPO_INIT, sandboxed], { encoding: "utf8" })
    if (r.status !== 0) throw new Error(`repo-init.sh failed: ${r.stderr}`)
    await orch.createTask({ repo: sandboxed, title: "fixture" })
    expect(orch.listTasks().filter((t) => t.kind === "main")).toHaveLength(0)
    expect(getSavedRepos()).not.toContain(sandboxed)
  })
})
