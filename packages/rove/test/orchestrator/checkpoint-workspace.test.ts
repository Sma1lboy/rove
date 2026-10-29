/**
 * Checkpoints belong to the workspace owner. Real git and a real
 * `GitWorktreeManager`; only the task index is a throwaway store.
 */

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Orchestrator } from "../../src/orchestrator/core.ts"
import { TaskIndexStore } from "../../src/orchestrator/index/store.ts"
import { GitWorktreeManager } from "../../src/orchestrator/worktree/manager.ts"
import type { Task } from "../../src/types/task.ts"

const DURABLE_WRITE_TIMEOUT_MS = 30_000

let tmpRoot: string
let repo: string
let wt: string
let store: TaskIndexStore
let orch: Orchestrator

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" })
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`)
  return r.stdout
}

const refsOf = (taskId: string): string[] =>
  git(repo, "for-each-ref", "--format=%(refname)", `refs/rove/checkpoints/${taskId}/`).split("\n").filter(Boolean)

beforeEach(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rove-ckpt-ws-"))
  repo = path.join(tmpRoot, "repo")
  fs.mkdirSync(repo)
  git(repo, "init", "-q", ".")
  git(repo, "config", "user.email", "t@example.com")
  git(repo, "config", "user.name", "T")
  fs.writeFileSync(path.join(repo, "a.txt"), "a0\n")
  git(repo, "add", "-A")
  git(repo, "commit", "-qm", "init")
  wt = path.join(tmpRoot, "wt")
  git(repo, "worktree", "add", "-q", wt, "-b", "feature")
  store = new TaskIndexStore({ homeDir: path.join(tmpRoot, "home") })
  await store.load()
  orch = new Orchestrator({ store, worktrees: new GitWorktreeManager() })
})

afterEach(() => {
  orch.dispose()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

async function row(title: string, shares?: Task): Promise<Task> {
  return store.create({
    repo,
    title,
    branch: "feature",
    worktreePath: wt,
    status: "backlog",
    kind: "task",
    vendor: "claude",
    ...(shares ? { parentTaskId: shares.id, sharesWorkspaceOf: shares.id } : {}),
  })
}

describe("workspace-owned checkpoints", { timeout: DURABLE_WRITE_TIMEOUT_MS }, () => {
  it("a shared child resolves to its owner for scope, snapshot and list, and the owner dedups against it", async () => {
    const owner = await row("owner")
    const child = await row("child", owner)

    expect(orch.checkpointScope(child.id)).toEqual({
      ownerId: String(owner.id),
      sharerIds: [String(owner.id), String(child.id)],
    })
    expect(orch.canCheckpoint(child.id)).toBe(true)

    fs.writeFileSync(path.join(wt, "a.txt"), "a1\n")
    const fromChild = await orch.takeCheckpoint(child.id, { tabId: "tab-1" })
    expect(fromChild.created).toBe(true)
    expect(refsOf(String(owner.id))).toEqual([`refs/rove/checkpoints/${owner.id}/1`])
    expect(refsOf(String(child.id))).toEqual([])
    expect((await orch.listCheckpoints(child.id)).map((c) => c.n)).toEqual([1])

    expect((await orch.takeCheckpoint(owner.id)).created).toBe(false)
  })

  it("a sharer whose owner is not a managed task is not checkpointable", async () => {
    const main = await store.create({
      repo,
      title: "main",
      branch: "main",
      worktreePath: repo,
      status: "backlog",
      kind: "main",
      vendor: "claude",
    })
    const child = await store.create({
      repo,
      title: "child of main",
      branch: "main",
      worktreePath: repo,
      status: "backlog",
      kind: "task",
      vendor: "claude",
      sharesWorkspaceOf: main.id,
    })
    expect(orch.canCheckpoint(child.id)).toBe(false)
    await expect(orch.takeCheckpoint(child.id)).rejects.toThrow(/^NOT_CHECKPOINTABLE:/)
  })

  it("when the owner is deleted, the heir inherits its checkpoint history", async () => {
    const owner = await row("owner")
    const child = await row("child", owner)
    fs.writeFileSync(path.join(wt, "a.txt"), "a1\n")
    await orch.takeCheckpoint(owner.id)
    fs.writeFileSync(path.join(wt, "a.txt"), "a2\n")
    await orch.takeCheckpoint(owner.id)

    await orch.deleteTask(owner.id)

    expect(refsOf(String(owner.id))).toEqual([])
    expect(refsOf(String(child.id))).toEqual([
      `refs/rove/checkpoints/${child.id}/1`,
      `refs/rove/checkpoints/${child.id}/2`,
    ])
    // The directory stayed with the heir, who now owns the history it can rewind.
    expect(orch.checkpointScope(child.id).ownerId).toBe(String(child.id))
    await orch.rewindToCheckpoint(child.id, 1)
    expect(fs.readFileSync(path.join(wt, "a.txt"), "utf8")).toBe("a1\n")
  })
})
