/**
 * `update --progress`: a worker's passive progress line. It must survive a
 * daemon restart, replace (never append), and leave the status label and the
 * worker's report exactly as they were — a coordinator reads those as claims.
 */

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Orchestrator } from "../../src/orchestrator/core.ts"
import { TaskIndexStore } from "../../src/orchestrator/index/store.ts"
import { GitWorktreeManager } from "../../src/orchestrator/worktree/manager.ts"

describe("task progress line", () => {
  let home: string
  let orch: Orchestrator

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "rove-progress-"))
    vi.stubEnv("ROVE_HOME_DIR", home)
    const store = new TaskIndexStore({ homeDir: home })
    await store.load()
    orch = new Orchestrator({ store, worktrees: new GitWorktreeManager() })
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    orch.dispose()
    await rm(home, { recursive: true, force: true })
  })

  it("replaces the previous line as one line, keeps status and report, and survives a reload", async () => {
    const task = await orch.createTask({ repo: "/repo", title: "t", branch: "t", vendor: "claude" })
    await orch.setStatus(task.id, "in_progress")
    await orch.setWorkerReport(task.id, { summary: "first pass" })
    await orch.setProgress(task.id, "reading the parser")
    await orch.setProgress(task.id, "  running the\n e2e suite  ")

    const store = new TaskIndexStore({ homeDir: home })
    await store.load()
    const reloaded = store.get(task.id)
    expect(reloaded?.progress?.note).toBe("running the e2e suite")
    expect(reloaded?.status).toBe("in_progress")
    expect(reloaded?.report?.summary).toBe("first pass")
  })

  it("a blank line clears it", async () => {
    const task = await orch.createTask({ repo: "/repo", title: "t", branch: "t", vendor: "claude" })
    await orch.setProgress(task.id, "reading the parser")
    await orch.setProgress(task.id, "   ")
    expect(orch.getTask(task.id)?.progress).toBeUndefined()
  })
})
