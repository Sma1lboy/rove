/**
 * A normalized `turn-complete` report makes the daemon checkpoint the task's
 * worktree; `task.rewind` refuses while the engine is mid-turn. Real git and a
 * real `GitWorktreeManager` behind a fake orchestrator, so the whole path —
 * receiver → per-task queue → refs in the repo — is exercised without a socket.
 */

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { DaemonActivityRegistry } from "@sma1lboy/rove-daemon/daemon/activity-registry"
import type { DaemonHandlerContext } from "@sma1lboy/rove-daemon/daemon/server"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { GitWorktreeManager } from "../../src/orchestrator/worktree/manager.ts"
import { TASK, dispatch, fakeCtx } from "./handler-test-context.ts"

let tmpRoot: string
let wt: string
const mgr = new GitWorktreeManager()

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" })
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`)
  return r.stdout
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rove-ckpt-daemon-"))
  const repo = path.join(tmpRoot, "repo")
  fs.mkdirSync(repo)
  git(repo, "init", "-q", ".")
  git(repo, "config", "user.email", "t@example.com")
  git(repo, "config", "user.name", "T")
  fs.writeFileSync(path.join(repo, "a.txt"), "a0\n")
  git(repo, "add", "-A")
  git(repo, "commit", "-qm", "init")
  wt = path.join(tmpRoot, "wt")
  git(repo, "worktree", "add", "-q", wt, "-b", "feature")
})

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

/** The two tasks sharing `wt`: owner `t1` and its shared child `child1`. */
const SHARERS = ["t1", "child1"]
const scopeOf = (id: string) => ({ ownerId: SHARERS.includes(id) ? "t1" : id, sharerIds: SHARERS })

/** A handler context whose orchestrator checkpoints `wt` for owner `t1` and its sharer `child1` (or refuses, as a main task does). */
function ctxFor(
  opts: { checkpointable?: boolean; engineState?: string; engineStates?: Record<string, string> } = {},
): DaemonHandlerContext {
  const { ctx } = fakeCtx({
    listTasks: () => [{ ...TASK, worktreePath: wt }],
    canCheckpoint: () => opts.checkpointable !== false,
    checkpointScope: scopeOf,
    takeCheckpoint: (id: string, o?: { tabId?: string }) => mgr.takeCheckpoint(wt, scopeOf(id).ownerId, o),
    listCheckpoints: (id: string) => mgr.listCheckpoints(wt, scopeOf(id).ownerId),
    rewindToCheckpoint: (id: string, n: number) => mgr.rewindToCheckpoint(wt, scopeOf(id).ownerId, n),
  })
  return {
    ...ctx,
    activity: {
      ...ctx.activity,
      stateOf: (id: string) => opts.engineStates?.[id] ?? opts.engineState,
    } as unknown as DaemonActivityRegistry,
  }
}

const turnComplete = (ctx: DaemonHandlerContext, taskId = "t1") =>
  dispatch("engine.reportEvent", { kind: "turn-complete", taskId, tabId: "tab-2" }, ctx)

describe("turn-complete checkpoints", () => {
  it("snapshots the worktree after the report, skips an unchanged tree, and takes the next number after an edit", async () => {
    const ctx = ctxFor()
    fs.writeFileSync(path.join(wt, "a.txt"), "a1\n")

    await turnComplete(ctx)
    await ctx.checkpoints.drain()
    const first = await mgr.listCheckpoints(wt, "t1")
    expect(first.map((c) => [c.n, c.tabId])).toEqual([[1, "tab-2"]])

    await turnComplete(ctx)
    await ctx.checkpoints.drain()
    expect((await mgr.listCheckpoints(wt, "t1")).length).toBe(1)

    fs.writeFileSync(path.join(wt, "new.txt"), "n\n")
    await turnComplete(ctx)
    await ctx.checkpoints.drain()
    expect((await mgr.listCheckpoints(wt, "t1")).map((c) => c.n)).toEqual([1, 2])
    // The tree was never touched: HEAD still the init commit, edits still unstaged.
    expect(git(wt, "log", "--format=%s")).toBe("init\n")
  })

  it("does not checkpoint a task the orchestrator gates out, nor on other event kinds", async () => {
    const gated = ctxFor({ checkpointable: false })
    await turnComplete(gated)
    await gated.checkpoints.drain()
    const open = ctxFor()
    await dispatch("engine.reportEvent", { kind: "turn-start", taskId: "t1", tabId: "tab-2" }, open)
    await open.checkpoints.drain()
    expect(await mgr.listCheckpoints(wt, "t1")).toEqual([])
  })
})

describe("task.rewind", () => {
  it("refuses while the engine is running unless forced, and reports the undo checkpoint", async () => {
    const busy = ctxFor({ engineState: "running" })
    fs.writeFileSync(path.join(wt, "a.txt"), "a1\n")
    await dispatch("task.checkpoint", { taskId: "t1" }, busy)
    fs.writeFileSync(path.join(wt, "a.txt"), "a2\n")

    await expect(dispatch("task.rewind", { taskId: "t1", to: 1 }, busy)).rejects.toThrow(/^TASK_BUSY:/)
    expect(fs.readFileSync(path.join(wt, "a.txt"), "utf8")).toBe("a2\n")

    const res = (await dispatch("task.rewind", { taskId: "t1", to: 1, force: true }, busy)) as {
      target: { n: number }
      undo: { n: number }
    }
    expect(res.target.n).toBe(1)
    expect(res.undo.n).toBe(2)
    expect(fs.readFileSync(path.join(wt, "a.txt"), "utf8")).toBe("a1\n")
  })

  it("rejects a missing or non-positive --to before touching anything", async () => {
    const ctx = ctxFor()
    await expect(dispatch("task.rewind", { taskId: "t1" }, ctx)).rejects.toThrow(/to must be/)
    await expect(dispatch("task.rewind", { taskId: "t1", to: 0 }, ctx)).rejects.toThrow(/to must be/)
  })

  it("lists checkpoints in numeric order over task.checkpointList", async () => {
    const ctx = ctxFor()
    for (const v of ["1", "2"]) {
      fs.writeFileSync(path.join(wt, "a.txt"), `v${v}\n`)
      await dispatch("task.checkpoint", { taskId: "t1" }, ctx)
    }
    const res = (await dispatch("task.checkpointList", { taskId: "t1" }, ctx)) as { checkpoints: { n: number }[] }
    expect(res.checkpoints.map((c) => c.n)).toEqual([1, 2])
  })
})

describe("a workspace shared by an owner and a child", () => {
  it("checkpoints a child's turn under the owner's id and dedups against the owner's latest tree", async () => {
    const ctx = ctxFor()
    fs.writeFileSync(path.join(wt, "a.txt"), "a1\n")

    await turnComplete(ctx, "child1")
    await ctx.checkpoints.drain()
    expect((await mgr.listCheckpoints(wt, "t1")).map((c) => c.n)).toEqual([1])
    expect(await mgr.listCheckpoints(wt, "child1")).toEqual([])

    // Same tree reported by the owner: already the owner's latest, so nothing new.
    await turnComplete(ctx, "t1")
    await ctx.checkpoints.drain()
    expect((await mgr.listCheckpoints(wt, "t1")).length).toBe(1)
  })

  it("lists, checkpoints and rewinds a child's --task-id against the owner's history and names it", async () => {
    const ctx = ctxFor()
    fs.writeFileSync(path.join(wt, "a.txt"), "a1\n")
    const taken = (await dispatch("task.checkpoint", { taskId: "child1" }, ctx)) as {
      workspaceTaskId: string
      checkpoint: { n: number }
    }
    expect(taken).toMatchObject({ workspaceTaskId: "t1", created: true, checkpoint: { n: 1 } })

    fs.writeFileSync(path.join(wt, "a.txt"), "a2\n")
    const listed = (await dispatch("task.checkpointList", { taskId: "child1" }, ctx)) as {
      workspaceTaskId: string
      checkpoints: { n: number }[]
    }
    expect(listed.workspaceTaskId).toBe("t1")
    expect(listed.checkpoints.map((c) => c.n)).toEqual([1])

    const rewound = (await dispatch("task.rewind", { taskId: "child1", to: 1 }, ctx)) as { workspaceTaskId: string }
    expect(rewound.workspaceTaskId).toBe("t1")
    expect(fs.readFileSync(path.join(wt, "a.txt"), "utf8")).toBe("a1\n")
  })

  it("refuses a rewind while a sibling sharer's engine runs, naming it, unless forced", async () => {
    // The owner is idle; the child that did NOT ask is mid-turn in the same files.
    const ctx = ctxFor({ engineStates: { child1: "running" } })
    fs.writeFileSync(path.join(wt, "a.txt"), "a1\n")
    await dispatch("task.checkpoint", { taskId: "t1" }, ctx)
    fs.writeFileSync(path.join(wt, "a.txt"), "a2\n")

    await expect(dispatch("task.rewind", { taskId: "t1", to: 1 }, ctx)).rejects.toThrow(/^TASK_BUSY:.*child1/)
    expect(fs.readFileSync(path.join(wt, "a.txt"), "utf8")).toBe("a2\n")

    await dispatch("task.rewind", { taskId: "t1", to: 1, force: true }, ctx)
    expect(fs.readFileSync(path.join(wt, "a.txt"), "utf8")).toBe("a1\n")
  })
})
