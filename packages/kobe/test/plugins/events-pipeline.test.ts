/**
 * Regression: the historically DROPPED plugin events now fire from the real
 * orchestrator calls, not just from hand-built snapshot pairs.
 *
 * Wiring mirrors server.ts exactly: `orch.subscribeTasks` → `serializeTask`
 * → `PluginEventReducer.reduce` (the bus is a pass-through for the reducer,
 * so feeding it directly is the same seam). Real git + real store on disk —
 * adopt shells `git worktree list`, so mocking would only test the mock.
 *
 * The two fixed paths:
 *  - `adoptWorktree` creates the task WITH its worktree → both
 *    `task.created` and `worktree.created` (previously: neither the
 *    `ensureWorktree` job nor any handler fired for adopt).
 *  - `setArchived(true)` — the exact orchestrator call the
 *    `worktree.archiveRemoved` sweep and `land --then-archive` make —
 *    → `task.archived` (previously only the archive RPC handler fired it).
 */

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { serializeTask } from "@sma1lboy/kobe-daemon/daemon/protocol"
import { type PluginEvent, PluginEventReducer } from "@sma1lboy/kobe-daemon/plugins/events"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { Orchestrator } from "../../src/orchestrator/core.ts"
import { TaskIndexStore } from "../../src/orchestrator/index/store.ts"
import { GitWorktreeManager } from "../../src/orchestrator/worktree/manager.ts"

const REPO_INIT = path.resolve(__dirname, "../orchestrator/fixtures/repo-init.sh")

let tmpRoot: string
let repo: string
let orch: Orchestrator
let events: PluginEvent[]
let unsubscribe: () => void

beforeEach(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kobe-plugin-pipeline-"))
  repo = path.join(tmpRoot, "repo")
  const r = spawnSync("bash", [REPO_INIT, repo], { encoding: "utf8" })
  if (r.status !== 0) throw new Error(`repo-init.sh failed: ${r.stderr}\n${r.stdout}`)
  const store = new TaskIndexStore({ homeDir: path.join(tmpRoot, "home") })
  await store.load()
  orch = new Orchestrator({ store, worktrees: new GitWorktreeManager() })
  // The server.ts pipeline, minus the bus (a pass-through for the reducer).
  const reducer = new PluginEventReducer()
  events = []
  unsubscribe = orch.subscribeTasks((snapshot) => {
    events.push(
      ...reducer.reduce({
        channel: "task.snapshot",
        payload: { tasks: snapshot.map((t) => serializeTask(t as never)) },
      } as never),
    )
  })
  // Drain the baseline snapshot (subscribe replays eagerly).
  events.length = 0
})

afterEach(() => {
  unsubscribe()
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  } catch {
    // ignored
  }
})

function names(): string[] {
  return events.map((e) => e.event)
}

describe("dropped-path regressions through the real orchestrator", () => {
  test("adoptWorktree fires task.created AND worktree.created", async () => {
    const ext = path.join(tmpRoot, "ext-feat")
    const r = spawnSync("git", ["worktree", "add", "-b", "feat", ext], { cwd: repo, encoding: "utf8" })
    if (r.status !== 0) throw new Error(`git worktree add failed: ${r.stderr}`)

    const task = await orch.adoptWorktree({ repo, worktreePath: ext, branch: "feat" })

    // Adopt also ensures the project main task; scope to the adopted id.
    const mine = events.filter((e) => e.taskId === task.id)
    expect(mine.map((e) => e.event)).toEqual(["task.created", "worktree.created"])
    expect(mine[1]?.task?.worktreePath).toBe(fs.realpathSync(ext))
  })

  test("setArchived — the sweep/land archive call — fires task.archived; restore does not", async () => {
    const ext = path.join(tmpRoot, "ext-arch")
    const r = spawnSync("git", ["worktree", "add", "-b", "arch", ext], { cwd: repo, encoding: "utf8" })
    if (r.status !== 0) throw new Error(`git worktree add failed: ${r.stderr}`)
    const task = await orch.adoptWorktree({ repo, worktreePath: ext, branch: "arch" })
    events.length = 0

    await orch.setArchived(task.id, true)
    expect(names()).toContain("task.archived")

    events.length = 0
    await orch.setArchived(task.id, false)
    expect(names()).not.toContain("task.archived")
    expect(names()).toContain("task.changed")
  })
})
