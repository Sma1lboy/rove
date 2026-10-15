import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type TaskOpsDeps, taskOps } from "../src/ops/taskops.ts"
import { taskOpDeps } from "../src/ops/tasks-shared.ts"
import { ENGINES, T, fakeApi } from "./task-ops-harness.ts"

const deps = (over: Partial<TaskOpsDeps> = {}): TaskOpsDeps => ({
  homeDir: () => "/home/me",
  buildCIPrompt: async (wt, s) => `fix ${s.branch} in ${wt}: ${s.checks.map((c) => c.jobName).join(",")}`,
  reorderTab: () => true,
  openExternal: () => {},
  canonical: (path) => path,
  runnable: () => false,
  ...over,
})

async function run(op: string, args: Record<string, unknown>, replies: Record<string, unknown> = {}, d = deps()) {
  const { api, calls } = fakeApi({ "engine-list": ENGINES, ...replies })
  const spec = taskOps(d)[op]
  if (!spec) throw new Error(`no op ${op}`)
  return { result: await spec.run(args, { api }), calls }
}

describe("task.landPreflight", () => {
  test("answers the daemon's probe unwrapped, so the client can name the destination and commit count", async () => {
    const probe = { branch: "feat", landedOn: "main", ahead: 3, baseDir: "/r" }
    const { result, calls } = await run(
      "task.landPreflight",
      { taskId: T },
      { "task.landPreflight": { result: probe } },
    )
    expect(result).toEqual(probe)
    expect(calls).toEqual([{ rpc: "task.landPreflight", payload: { taskId: T } }])
  })

  test("refuses a task id that could read as a flag", async () => {
    await expect(run("task.landPreflight", { taskId: "--x" })).rejects.toMatchObject({ code: "BAD_ARGS" })
  })
})

describe("task.syncBase", () => {
  test("reports the base ref and whether anything merged", async () => {
    const { result } = await run(
      "task.syncBase",
      { taskId: T },
      { "task.syncBase": { result: { baseRef: "main", alreadyCurrent: true } } },
    )
    expect(result).toEqual({ baseRef: "main", alreadyCurrent: true })
  })

  test("a daemon refusal keeps its marker for the client", async () => {
    const { api } = fakeApi()
    api.rpc = async () => {
      throw Object.assign(new Error("SYNC_CONFLICT: a.ts"), { code: "RPC_ERROR" })
    }
    await expect(taskOps(deps())["task.syncBase"]?.run({ taskId: T }, { api })).rejects.toThrow(/SYNC_CONFLICT/)
  })
})

describe("task.fixChecks", () => {
  const task = { task: { worktreePath: "/wt", branch: "feat", prStatus: { number: 7 } } }
  const failing = { checks: [{ jobName: "lint", conclusion: "failure", url: "u", tail: "t" }], totalFailing: 1 }

  test("sends the rendered prompt to the engine as plain text on the asked tab", async () => {
    const { result, calls } = await run(
      "task.fixChecks",
      { taskId: T, tabId: "tab-2" },
      { "get-task": task, "pr.failingChecks": failing },
    )
    expect(result).toEqual({ outcome: "sent" })
    expect(calls.at(-1)).toEqual({
      verb: "send",
      argv: [`--task-id=${T}`, "--plain", "--prompt=fix feat in /wt: lint", "--tab=tab-2"],
    })
  })

  test("`gh` not answering and nothing red are different outcomes, and nothing is sent", async () => {
    const down = await run(
      "task.fixChecks",
      { taskId: T },
      { "get-task": task, "pr.failingChecks": { unavailable: { reason: "gh", detail: "gh: not logged in" } } },
    )
    expect(down.result).toEqual({ outcome: "unavailable", detail: "gh: not logged in" })
    const green = await run("task.fixChecks", { taskId: T }, { "get-task": task, "pr.failingChecks": { checks: [] } })
    expect(green.result).toEqual({ outcome: "none" })
    expect([...down.calls, ...green.calls].some((c) => "verb" in c && c.verb === "send")).toBe(false)
  })

  test("a task with no worktree is refused before any log is fetched", async () => {
    await expect(run("task.fixChecks", { taskId: T }, { "get-task": { task: {} } })).rejects.toMatchObject({
      code: "NO_WORKTREE",
    })
  })
})

describe("tab.move", () => {
  test("up swaps with the previous tab and down with the next; the answer says whether anything moved", async () => {
    const moves: Array<[string, string, number]> = []
    const d = deps({
      reorderTab: (task, tab, delta) => {
        moves.push([task, tab, delta])
        return tab !== "tab-1"
      },
    })
    expect((await run("tab.move", { taskId: T, tabId: "tab-2", direction: "up" }, {}, d)).result).toEqual({
      moved: true,
    })
    expect((await run("tab.move", { taskId: T, tabId: "tab-1", direction: "down" }, {}, d)).result).toEqual({
      moved: false,
    })
    expect(moves).toEqual([
      [T, "tab-2", -1],
      [T, "tab-1", 1],
    ])
  })

  test("refuses a direction that is not up or down, and a tab id that is not a tab", async () => {
    await expect(run("tab.move", { taskId: T, tabId: "tab-2", direction: "top" })).rejects.toMatchObject({
      code: "BAD_ARGS",
    })
    await expect(run("tab.move", { taskId: T, tabId: "../x", direction: "up" })).rejects.toMatchObject({
      code: "BAD_ARGS",
    })
  })
})

describe("task.openScratch", () => {
  test("always opens the Mac's home as a scratch dir task; the client names no directory", async () => {
    const { result, calls } = await run(
      "task.openScratch",
      { dir: "/etc", engine: "codex" },
      { "task.openDir": { taskId: "S1" } },
    )
    expect(result).toEqual({ taskId: "S1" })
    expect(calls.at(-1)).toEqual({
      rpc: "task.openDir",
      payload: { dir: "/home/me", scratch: true, vendor: "codex" },
    })
  })

  test("no engine opens a bare scratch task; an unknown engine is refused", async () => {
    const bare = await run("task.openScratch", {}, { "task.openDir": { taskId: "S2" } })
    expect(bare.calls.at(-1)).toEqual({ rpc: "task.openDir", payload: { dir: "/home/me", scratch: true } })
    await expect(run("task.openScratch", { engine: "nope" })).rejects.toMatchObject({ code: "UNKNOWN_ENGINE" })
  })
})

describe("task.setEngine", () => {
  test("sets engine, level and model in one daemon call; '' clears a pinned value", async () => {
    const { calls } = await run("task.setEngine", { taskId: T, engine: "codex", effort: "high", model: "" })
    expect(calls.at(-1)).toEqual({
      rpc: "task.setVendor",
      payload: { taskId: T, vendor: "codex", effort: "high", model: "" },
    })
  })

  test("leaves level and model alone when absent", async () => {
    const { calls } = await run("task.setEngine", { taskId: T, engine: "claude" })
    expect(calls.at(-1)).toEqual({ rpc: "task.setVendor", payload: { taskId: T, vendor: "claude" } })
  })

  test("refuses an engine the registry does not list and a model that is not an id", async () => {
    await expect(run("task.setEngine", { taskId: T, engine: "rm -rf" })).rejects.toMatchObject({ code: "BAD_ARGS" })
    await expect(run("task.setEngine", { taskId: T, engine: "claude", model: "a b; c" })).rejects.toMatchObject({
      code: "BAD_ARGS",
    })
  })
})

describe("fs.subdirs and repo.probe", () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "taskops-"))
    for (const d of ["alpha", "alps", "beta", ".hidden"]) mkdirSync(join(root, d))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  test("lists the subdirectories under the typed parent by prefix, hiding dotdirs like `ls`", async () => {
    const { result } = await run("fs.subdirs", { path: `${root}/al` })
    expect(result).toEqual({ base: `${root}/`, home: "/home/me", names: ["alpha", "alps"] })
    const all = await run("fs.subdirs", { path: `${root}/` })
    expect(all.result).toMatchObject({ names: ["alpha", "alps", "beta"] })
  })

  test("only absolute or ~ paths are listed", async () => {
    await expect(run("fs.subdirs", { path: "relative/x" })).rejects.toMatchObject({ code: "BAD_ARGS" })
  })

  test("probe names the reason a path is not a repo and lists branches for one that is", async () => {
    const saved = { ...taskOpDeps }
    try {
      taskOpDeps.validateRepoPath = (p) => (p === "/r" ? null : `path does not exist: ${p}`)
      taskOpDeps.listLocalBranches = () => ["main", "dev"]
      taskOpDeps.getCurrentBranch = () => "dev"
      const bad = await run("repo.probe", { path: "/nope/" })
      expect(bad.result).toEqual({ ok: false, repo: "/nope", reason: "path does not exist: /nope" })
      const ok = await run("repo.probe", { path: "/r/" })
      expect(ok.result).toEqual({ ok: true, repo: "/r", branches: ["main", "dev"], current: "dev" })
      const withWt = await run(
        "repo.probe",
        { path: "/r", adoptable: true },
        { "worktree.discoverAdoptable": { worktrees: [{ path: "/w" }] } },
      )
      expect(withWt.result).toMatchObject({ worktrees: [{ path: "/w" }] })
    } finally {
      Object.assign(taskOpDeps, saved)
    }
  })
})

describe("file.openExternal", () => {
  const wt = mkdtempSync(join(tmpdir(), "rove-open-"))
  const outside = mkdtempSync(join(tmpdir(), "rove-outside-"))
  const real = (opened: string[]) =>
    deps({
      openExternal: (p) => opened.push(p),
      canonical: (p) => {
        try {
          return require("node:fs").realpathSync(p)
        } catch {
          return null
        }
      },
      runnable: (p) => (require("node:fs").statSync(p).mode & 0o111) !== 0,
    })
  const reply = { "get-task": { task: { worktreePath: wt } } }
  writeFileSync(join(wt, "pic.png"), "x")
  writeFileSync(join(wt, "run.png"), "x")
  chmodSync(join(wt, "run.png"), 0o755)
  writeFileSync(join(wt, "notes.txt"), "x")
  writeFileSync(join(outside, "secret.png"), "x")
  symlinkSync(join(outside, "secret.png"), join(wt, "link.png"))

  afterEach(() => {})

  test("opens a media file inside the worktree in the Mac's opener", async () => {
    const opened: string[] = []
    await run("file.openExternal", { taskId: T, path: "pic.png" }, reply, real(opened))
    expect(opened).toEqual([require("node:fs").realpathSync(join(wt, "pic.png"))])
  })

  test("refuses anything the OS would run, plain text, climbs and symlinks out of the worktree", async () => {
    const opened: string[] = []
    for (const path of ["run.png", "notes.txt", "../x.png", "/etc/hosts.png", "link.png", "missing.png"]) {
      await expect(run("file.openExternal", { taskId: T, path }, reply, real(opened))).rejects.toThrow()
    }
    expect(opened).toEqual([])
  })
})
