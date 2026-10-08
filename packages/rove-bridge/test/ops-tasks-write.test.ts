import { describe, expect, test } from "bun:test"
import { taskOpDeps } from "../src/ops/tasks-shared.ts"
import { TASK_OPS } from "../src/ops/tasks.ts"
import { type Call, REPO, T, fakeApi, isolateTaskOpDeps, refused, run } from "./task-ops-harness.ts"

isolateTaskOpDeps()

describe("task.spawn", () => {
  test("single task: every flag goes through --name=value", async () => {
    const { result, calls } = await run(
      "task.spawn",
      {
        repo: REPO,
        engine: "claude",
        title: "T",
        prompt: "--force",
        branch: "feat/x",
        baseBranch: "main",
        model: "claude-opus-5-5",
        effort: "high",
        status: "in_progress",
        pin: true,
      },
      { add: { taskId: "N1", task: {} } },
    )
    expect(calls.at(-1)).toEqual({
      verb: "add",
      argv: [
        `--repo=${REPO}`,
        "--title=T",
        "--branch=feat/x",
        "--base-branch=main",
        "--command=claude",
        "--effort=high",
        "--model=claude-opus-5-5",
        "--status=in_progress",
        "--pin=true",
        "--prompt=--force",
      ],
    })
    expect(result).toEqual({ taskIds: ["N1"] })
  })

  test("count fleet normalizes to taskIds + groupId", async () => {
    const { result, calls } = await run(
      "task.spawn",
      { repo: REPO, prompt: "p", count: 3 },
      { add: { groupId: "G", tasks: [{ taskId: "a" }, { taskId: "b" }, { taskId: "c" }], failures: [] } },
    )
    expect(calls.at(-1)).toEqual({ verb: "add", argv: [`--repo=${REPO}`, "--count=3", "--prompt=p"] })
    expect(result).toEqual({ taskIds: ["a", "b", "c"], groupId: "G" })
  })

  test("agents plan is normalized and engine-checked", async () => {
    const { result, calls } = await run(
      "task.spawn",
      { repo: REPO, prompt: "p", agents: "claude:2,codex:1" },
      { add: { groupId: "G", tasks: [{ taskId: "a" }] } },
    )
    expect(calls.at(-1)).toEqual({ verb: "add", argv: [`--repo=${REPO}`, "--agents=claude:2,codex:1", "--prompt=p"] })
    expect(result).toEqual({ taskIds: ["a"], groupId: "G" })
  })

  test("refuses bad shapes before any verb runs", async () => {
    const bad: Array<Record<string, unknown>> = [
      { repo: "relative" },
      { repo: REPO, engine: "--command=evil" },
      { repo: REPO, engine: "rm -rf /" },
      { repo: REPO, engine: "nope" },
      { repo: REPO, branch: "--upload-pack=x" },
      { repo: REPO, branch: "a..b" },
      { repo: REPO, branch: "x/" },
      { repo: REPO, branch: "x.lock" },
      { repo: REPO, baseBranch: "-x" },
      { repo: REPO, model: "a b" },
      { repo: REPO, model: "--x" },
      { repo: REPO, effort: "HIGH" },
      { repo: REPO, effort: "--x" },
      { repo: REPO, status: "shipped" },
      { repo: REPO, pin: "yes" },
      { repo: REPO, title: "x".repeat(201) },
      { repo: REPO, count: 0, prompt: "p" },
      { repo: REPO, count: 11, prompt: "p" },
      { repo: REPO, count: 2 },
      { repo: REPO, agents: "claude:2" },
      { repo: REPO, prompt: "p", count: 2, agents: "claude:1" },
      { repo: REPO, prompt: "p", agents: "claude:0" },
      { repo: REPO, prompt: "p", agents: "claude:11" },
      { repo: REPO, prompt: "p", agents: "claude:6,codex:5" },
      { repo: REPO, prompt: "p", agents: "claude:1,claude:1" },
      { repo: REPO, prompt: "p", agents: "nope:1" },
      { repo: REPO, prompt: "p", agents: "claude" },
      { repo: REPO, prompt: "p", agents: "claude:1,--x:1" },
      { repo: REPO, prompt: "p", agents: "claude:1", engine: "codex" },
      { repo: REPO, prompt: "p", count: 2, branch: "b" },
    ]
    for (const args of bad) await refused("task.spawn", args)
  })
})

describe("task edits", () => {
  const cases: Array<[string, Record<string, unknown>, Call, Record<string, unknown>?]> = [
    ["task.rename", { taskId: T, title: "--new" }, { verb: "update", argv: [`--task-id=${T}`, "--title=--new"] }],
    [
      "task.setBranch",
      { taskId: T, branch: "feat/y" },
      { verb: "update", argv: [`--task-id=${T}`, "--branch=feat/y"] },
    ],
    [
      "task.setModel",
      { taskId: T, model: "gpt-5.1:high" },
      { verb: "update", argv: [`--task-id=${T}`, "--model=gpt-5.1:high"] },
    ],
    ["task.setEffort", { taskId: T, level: "xhigh" }, { verb: "update", argv: [`--task-id=${T}`, "--effort=xhigh"] }],
    ["task.setStatus", { taskId: T, status: "done" }, { verb: "update", argv: [`--task-id=${T}`, "--status=done"] }],
    ["task.pin", { taskId: T, pinned: false }, { verb: "update", argv: [`--task-id=${T}`, "--pinned=false"] }],
    ["task.pin", { taskId: T, pinned: true }, { verb: "update", argv: [`--task-id=${T}`, "--pinned=true"] }],
    ["task.move", { taskId: T, direction: "top" }, { rpc: "task.move", payload: { taskId: T, direction: "top" } }],
    ["task.move", { taskId: T, direction: "up" }, { rpc: "task.move", payload: { taskId: T, direction: "up" } }],
  ]
  for (const [op, args, call] of cases) {
    test(`${op} ${JSON.stringify(args)} makes exactly one call and returns {}`, async () => {
      const { result, calls } = await run(op, args)
      expect(calls.filter((c) => !("verb" in c && c.verb === "engine-list"))).toEqual([call])
      expect(result).toEqual({})
    })
  }

  test("task.setCommand takes an engine id and reports the protocol", async () => {
    const { result, calls } = await run(
      "task.setCommand",
      { taskId: T, engine: "codex" },
      { update: { ok: true, command: "codex", protocol: "codex" } },
    )
    expect(calls.at(-1)).toEqual({ verb: "update", argv: [`--task-id=${T}`, "--command=codex"] })
    expect(result).toEqual({ protocol: "codex" })
    await refused("task.setCommand", { taskId: T, engine: "codex --search" })
    await refused("task.setCommand", { taskId: T, engine: "unknown" })
  })

  test("bad args are refused", async () => {
    const bad: Array<[string, Record<string, unknown>]> = [
      ["task.rename", { taskId: T }],
      ["task.rename", { taskId: T, title: "   " }],
      ["task.rename", { taskId: "--x", title: "a" }],
      ["task.setBranch", { taskId: T, branch: "--delete" }],
      ["task.setBranch", { taskId: T, branch: "a b" }],
      ["task.setBranch", { taskId: T, branch: `a${"b".repeat(200)}` }],
      ["task.setModel", { taskId: T, model: "-m" }],
      ["task.setEffort", { taskId: T, level: "Max" }],
      ["task.setEffort", { taskId: T, level: "x".repeat(21) }],
      ["task.setStatus", { taskId: T, status: "merged" }],
      ["task.pin", { taskId: T }],
      ["task.pin", { taskId: T, pinned: "false" }],
      ["task.move", { taskId: T, direction: "sideways" }],
    ]
    for (const [op, args] of bad) await refused(op, args)
  })
})

describe("project and notes", () => {
  test("project.forget calls the RPC for a known repo", async () => {
    const { result, calls } = await run("project.forget", { repo: REPO })
    expect(calls.at(-1)).toEqual({ rpc: "project.forget", payload: { repo: REPO } })
    expect(result).toEqual({})
  })

  test("notes.delete wraps note-delete and reports whether it deleted", async () => {
    const { result, calls } = await run("notes.delete", { repo: REPO, id: 7 }, { "note-delete": { deleted: true } })
    expect(calls.at(-1)).toEqual({ verb: "note-delete", argv: [`--repo=${REPO}`, "--id=7"] })
    expect(result).toEqual({ deleted: true })
    expect((await run("notes.delete", { repo: REPO, id: 8 }, { "note-delete": { deleted: false } })).result).toEqual({
      deleted: false,
    })
    for (const id of [0, -1, 1.5, "3", null, undefined]) await refused("notes.delete", { repo: REPO, id })
  })
})

describe("task.openMain and worktree.adopt", () => {
  test("openMain needs a usable git repo, not a known one, so a fresh clone can open", async () => {
    taskOpDeps.validateRepoPath = () => null
    const { result, calls } = await run(
      "task.openMain",
      { repo: "/work/fresh" },
      { "task.ensureMain": { task: { id: "M1" } } },
    )
    expect(calls.at(-1)).toEqual({ rpc: "task.ensureMain", payload: { repo: "/work/fresh" } })
    expect(result).toEqual({ taskId: "M1" })
    taskOpDeps.validateRepoPath = () => "not a git repo"
    await refused("task.openMain", { repo: "/etc" })
    await refused("task.openMain", { repo: "rel" })
  })

  test("adopt only takes a worktree discovery lists, and sends the engine as vendor", async () => {
    const replies = {
      "worktree.discoverAdoptable": { worktrees: [{ path: "/w/a" }], unreadable: [] },
      "worktree.adopt": { task: { id: "A1" } },
    }
    const { result, calls } = await run(
      "worktree.adopt",
      { repo: REPO, worktreePath: "/w/a", branch: "feat/a", title: "A", engine: "codex" },
      replies,
    )
    expect(calls.at(-1)).toEqual({
      rpc: "worktree.adopt",
      payload: { repo: REPO, worktreePath: "/w/a", branch: "feat/a", title: "A", vendor: "codex" },
    })
    expect(result).toEqual({ taskId: "A1" })
    await refused("worktree.adopt", { repo: REPO, worktreePath: "/etc" }, replies)
    await refused("worktree.adopt", { repo: REPO, worktreePath: "w/a" }, replies)
    await refused("worktree.adopt", { repo: REPO, worktreePath: "/w/a", engine: "bad engine" }, replies)
    await refused("worktree.adopt", { repo: REPO, worktreePath: "/w/a", branch: "-x" }, replies)
  })
})

describe("repo.clone", () => {
  function fakeClone() {
    const seen: Array<[string, string]> = []
    taskOpDeps.cloneRepo = async (url, target) => {
      seen.push([url, target])
      return { ok: true, path: target }
    }
    taskOpDeps.validateCloneTarget = () => null
    taskOpDeps.findAvailableFolderName = (_p, base) => base
    return seen
  }

  test("clones into parentDir/<derived folder>", async () => {
    const seen = fakeClone()
    const { result } = await run("repo.clone", { url: "git@github.com:foo/bar.git", parentDir: "/work" })
    expect(seen).toEqual([["git@github.com:foo/bar.git", "/work/bar"]])
    expect(result).toEqual({ path: "/work/bar" })
    expect((await run("repo.clone", { url: "https://h/x/y", parentDir: "/work", folder: "z" })).result).toEqual({
      path: "/work/z",
    })
  })

  test("a failed clone surfaces git's message", async () => {
    taskOpDeps.cloneRepo = async () => ({ ok: false, error: "fatal: repository not found" })
    taskOpDeps.validateCloneTarget = () => null
    const { api } = fakeApi()
    await expect(
      TASK_OPS["repo.clone"]?.run({ url: "https://h/x/y", parentDir: "/work" }, { api }),
    ).rejects.toMatchObject({
      code: "CLONE_FAILED",
      message: "fatal: repository not found",
    })
  })

  test("refuses option-shaped, helper-transport, local and malformed urls and folders without cloning", async () => {
    const seen = fakeClone()
    const bad: Array<Record<string, unknown>> = [
      { url: "-oProxyCommand=touch /tmp/x", parentDir: "/work" },
      { url: "--upload-pack=touch /tmp/x", parentDir: "/work" },
      { url: "ext::sh -c touch% /tmp/x", parentDir: "/work" },
      { url: "fd::17/foo", parentDir: "/work" },
      { url: "file:///etc", parentDir: "/work" },
      { url: "/etc/passwd", parentDir: "/work" },
      { url: "ssh://-oProxyCommand=x/y", parentDir: "/work" },
      { url: "ssh://user@-host/y", parentDir: "/work" },
      { url: "-x@host:path", parentDir: "/work" },
      { url: "https://h/x y", parentDir: "/work" },
      { url: "ftp://h/x", parentDir: "/work" },
      { url: "", parentDir: "/work" },
      { url: 5, parentDir: "/work" },
      { url: "https://h/x/y", parentDir: "rel" },
      { url: "https://h/x/y", parentDir: "~/code" },
      { url: "https://h/x/y", parentDir: "/work", folder: "../evil" },
      { url: "https://h/x/y", parentDir: "/work", folder: "a/b" },
      { url: "https://h/x/y", parentDir: "/work", folder: ".." },
      { url: "https://h/x/y", parentDir: "/work", folder: "-rf" },
    ]
    for (const args of bad) await refused("repo.clone", args)
    expect(seen).toEqual([])
  })

  test("accepts each allowed transport", async () => {
    const seen = fakeClone()
    for (const url of ["https://h/a/b.git", "http://h/a/b", "ssh://git@h:22/a/b", "git://h/a/b", "git@h:a/b.git"]) {
      await run("repo.clone", { url, parentDir: "/work" })
    }
    expect(seen.map(([u]) => u)).toHaveLength(5)
  })
})

describe("worktrees", () => {
  test("ensureWorktree returns the path", async () => {
    const { result, calls } = await run(
      "task.ensureWorktree",
      { taskId: T },
      { "ensure-worktree": { worktreePath: "/w/t" } },
    )
    expect(calls.at(-1)).toEqual({ verb: "ensure-worktree", argv: [`--task-id=${T}`] })
    expect(result).toEqual({ worktreePath: "/w/t" })
  })

  test("removeWorktree passes --force only when asked", async () => {
    const reply = { "remove-worktree": { ok: true, removed: true, worktreePath: "/w/t", branch: "b" } }
    const plain = await run("task.removeWorktree", { taskId: T }, reply)
    expect(plain.calls.at(-1)).toEqual({ verb: "remove-worktree", argv: [`--task-id=${T}`] })
    expect(plain.result).toEqual({ removed: true, worktreePath: "/w/t", branch: "b" })
    const forced = await run("task.removeWorktree", { taskId: T, force: true }, reply)
    expect(forced.calls.at(-1)).toEqual({ verb: "remove-worktree", argv: [`--task-id=${T}`, "--force=true"] })
    await refused("task.removeWorktree", { taskId: T, force: "true" }, reply)
    await refused("task.removeWorktree", { taskId: "x y" }, reply)
  })
})
