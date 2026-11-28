import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Orchestrator } from "@sma1lboy/rove-core/orchestrator/core.ts"
import { TaskIndexStore } from "@sma1lboy/rove-core/orchestrator/index/store.ts"
import { GitWorktreeManager } from "@sma1lboy/rove-core/orchestrator/worktree/manager.ts"
import { expect, it, vi } from "vitest"

it("the two-task tutorial isolates mock-provider output and restores selection from disk", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rove-onboarding-acceptance-")))
  const home = join(root, "home")
  const repo = join(root, "repo")
  const setup = spawnSync("bash", [resolve(__dirname, "fixtures/repo-init.sh"), repo], { encoding: "utf8" })
  expect(setup.status, setup.stderr).toBe(0)
  vi.stubEnv("ROVE_HOME_DIR", home)
  const store = new TaskIndexStore({ homeDir: home })
  await store.load()
  const orch = new Orchestrator({ store, worktrees: new GitWorktreeManager() })
  try {
    const a = await orch.createTask({ repo, title: "A first result", vendor: "codex" })
    const pathA = await orch.ensureWorktree(a.id)
    // The provider is mocked; worktree creation, files and persisted task state are real.
    writeFileSync(join(pathA, "rove-onboarding-a.txt"), "Task A works\n")
    const b = await orch.createTask({ repo, title: "B separate files", vendor: "codex" })
    const pathB = await orch.ensureWorktree(b.id)
    expect(pathA).not.toBe(pathB)
    expect(orch.getTask(a.id)?.branch).not.toBe(orch.getTask(b.id)?.branch)
    expect(existsSync(join(pathB, "rove-onboarding-a.txt"))).toBe(false)
    writeFileSync(join(pathB, "rove-onboarding-b.txt"), "Task B works\n")
    await orch.setActiveTask(a.id)
    expect(orch.activeTaskSignal()()).toBe(a.id)
    expect(readFileSync(join(pathA, "rove-onboarding-a.txt"), "utf8")).toBe("Task A works\n")
    expect(existsSync(join(pathA, "rove-onboarding-b.txt"))).toBe(false)
    await orch.setActiveTask(b.id)
    const restoredStore = new TaskIndexStore({ homeDir: home })
    await restoredStore.load()
    const restored = new Orchestrator({ store: restoredStore, worktrees: new GitWorktreeManager() })
    try {
      expect(restored.activeTaskSignal()()).toBe(b.id)
      expect(restored.getTask(a.id)?.worktreePath).toBe(pathA)
      expect(restored.getTask(b.id)?.worktreePath).toBe(pathB)
      expect(readFileSync(join(pathB, "rove-onboarding-b.txt"), "utf8")).toBe("Task B works\n")
      const directoryTask = await restored.openDirectoryTask({ dir: repo })
      expect(await restored.ensureWorktree(directoryTask.id)).toBe(repo)
      expect(directoryTask.branch).toBe("")
    } finally {
      restored.dispose()
    }
  } finally {
    orch.dispose()
    vi.unstubAllEnvs()
    rmSync(root, { recursive: true, force: true })
  }
})
