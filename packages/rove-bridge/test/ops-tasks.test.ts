import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { AREA_OPS } from "../src/ops/index.ts"
import { taskOpDeps } from "../src/ops/tasks-shared.ts"
import { TASK_OPS } from "../src/ops/tasks.ts"
import type { BridgeApi } from "../src/ops/types.ts"

type Call = { verb: string; argv: readonly string[] } | { rpc: string; payload: unknown }

/** Records every verb/RPC and answers from canned replies keyed by name. */
function fakeApi(replies: Record<string, unknown> = {}): { api: BridgeApi; calls: Call[] } {
  const calls: Call[] = []
  const reply = (name: string): unknown => {
    const r = replies[name]
    return typeof r === "function" ? (r as () => unknown)() : r
  }
  const api: BridgeApi = {
    async verb(name, argv) {
      calls.push({ verb: name, argv })
      return reply(name) as never
    },
    async rpc(name, payload) {
      calls.push({ rpc: name, payload })
      return reply(name) as never
    },
  }
  return { api, calls }
}

const ENGINES = { engines: [{ id: "claude" }, { id: "codex" }] }
const REPO = "/work/payments-api"
const TASKS = { tasks: [{ repo: REPO }] }

async function run(op: string, args: Record<string, unknown>, replies: Record<string, unknown> = {}) {
  const { api, calls } = fakeApi({ "engine-list": ENGINES, "task.list": TASKS, ...replies })
  const spec = TASK_OPS[op]
  if (!spec) throw new Error(`no op ${op}`)
  const result = await spec.run(args, { api })
  return { result, calls }
}

async function refused(op: string, args: Record<string, unknown>, replies: Record<string, unknown> = {}) {
  const { api, calls } = fakeApi({ "engine-list": ENGINES, "task.list": TASKS, ...replies })
  await expect(TASK_OPS[op]?.run(args, { api })).rejects.toMatchObject({ name: "BridgeError" })
  // Nothing that changes state ran.
  expect(
    calls.filter(
      (c) =>
        ("verb" in c && c.verb !== "engine-list") ||
        ("rpc" in c && c.rpc !== "task.list" && c.rpc !== "worktree.discoverAdoptable"),
    ),
  ).toEqual([])
}

const saved = { ...taskOpDeps }
beforeEach(() => {
  taskOpDeps.savedRepos = () => []
})
afterEach(() => {
  Object.assign(taskOpDeps, saved)
})

const T = "01M4756MVZKGC84R07M659BEJW"

describe("op table", () => {
  test("registers exactly the contract ops, and only these three are destructive", () => {
    expect(Object.keys(TASK_OPS).sort()).toEqual(
      [
        "task.get",
        "task.info",
        "repo.branches",
        "notes.list",
        "worktree.adoptable",
        "task.spawn",
        "task.rename",
        "task.setBranch",
        "task.setCommand",
        "task.setModel",
        "task.setEffort",
        "task.setStatus",
        "task.pin",
        "task.move",
        "project.forget",
        "notes.delete",
        "task.openMain",
        "worktree.adopt",
        "repo.clone",
        "task.ensureWorktree",
        "task.removeWorktree",
      ].sort(),
    )
    expect(
      Object.entries(TASK_OPS)
        .filter(([, s]) => s.destructive)
        .map(([n]) => n)
        .sort(),
    ).toEqual(["notes.delete", "project.forget", "task.removeWorktree"])
    for (const name of Object.keys(TASK_OPS)) expect(AREA_OPS[name]).toBe(TASK_OPS[name]!)
  })

  test("reads are reads", () => {
    for (const n of ["task.get", "task.info", "repo.branches", "notes.list", "worktree.adoptable"]) {
      expect(TASK_OPS[n]?.kind).toBe("read")
    }
  })
})

describe("task.get", () => {
  test("maps the daemon task: vendor→engine, modelEffort→effort, prStatus→pr", async () => {
    const { result, calls } = await run(
      "task.get",
      { taskId: T },
      {
        "get-task": {
          task: {
            id: T,
            title: "t",
            repo: REPO,
            branch: "b",
            worktreePath: "/w",
            kind: "task",
            status: "in_review",
            pinned: true,
            vendor: "claude",
            command: "claude --x",
            model: "opus",
            modelEffort: "high",
            prompt: "do it",
            baseRef: "main",
            groupId: "g",
            createdAt: "c",
            updatedAt: "u",
            prStatus: {
              number: 3,
              url: "u",
              lifecycle: "open",
              checkState: "passing",
              mergeable: "MERGEABLE",
              baseRef: "main",
            },
            report: { at: "r" },
          },
        },
      },
    )
    expect(calls).toEqual([{ verb: "get-task", argv: [`--task-id=${T}`] }])
    expect(result).toEqual({
      task: {
        id: T,
        title: "t",
        repo: REPO,
        branch: "b",
        worktreePath: "/w",
        kind: "task",
        status: "in_review",
        pinned: true,
        engine: "claude",
        command: "claude --x",
        model: "opus",
        effort: "high",
        prompt: "do it",
        baseRef: "main",
        groupId: "g",
        createdAt: "c",
        updatedAt: "u",
        pr: { number: 3, url: "u", lifecycle: "open", checkState: "passing", mergeable: "MERGEABLE", baseRef: "main" },
        report: { summary: "", at: "r" },
      },
    })
  })

  test("optional fields stay absent", async () => {
    const { result } = await run(
      "task.get",
      { taskId: T },
      {
        "get-task": {
          task: {
            id: T,
            title: "t",
            repo: REPO,
            branch: "b",
            worktreePath: "",
            status: "backlog",
            createdAt: "c",
            updatedAt: "u",
          },
        },
      },
    )
    expect(result).toEqual({
      task: {
        id: T,
        title: "t",
        repo: REPO,
        branch: "b",
        worktreePath: "",
        kind: "task",
        status: "backlog",
        pinned: false,
        createdAt: "c",
        updatedAt: "u",
      },
    })
  })

  test("refuses a flag-shaped id", async () => {
    await refused("task.get", { taskId: "--force" })
  })
})

describe("task.info", () => {
  const row = {
    taskId: T,
    running: true,
    activity: { state: "running", at: "x", forMs: 5 },
    changes: null,
    base: { baseRef: "main", ahead: 2, behind: 0, diff: null },
    tabs: [
      { id: "tab-1", kind: "engine", alive: true, exit: null, title: "x" },
      {
        id: "tab-2",
        kind: "engine",
        alive: false,
        exit: { code: 1, signal: null, at: "t", layer: "pty", tail: ["a", "b".repeat(3000)] },
      },
    ],
  }

  test("trims the first collect row; tail keeps the last 2000 chars; null changes stays null", async () => {
    const { result, calls } = await run("task.info", { taskId: T }, { collect: { tasks: [row] } })
    expect(calls).toEqual([{ verb: "collect", argv: [`--task-ids=${T}`] }])
    const r = result as { tabs: Array<Record<string, unknown>> } & Record<string, unknown>
    expect(r.changes).toBeNull()
    expect(r.activity).toEqual({ state: "running", forMs: 5 })
    expect(r.base).toEqual({ baseRef: "main", ahead: 2, behind: 0 })
    expect(r.tabs[0]).toEqual({ id: "tab-1", kind: "engine", alive: true })
    expect(r.tabs[1]).toEqual({
      id: "tab-2",
      kind: "engine",
      alive: false,
      exit: { code: 1, signal: null, cause: "pty" },
      tail: `\n${"b".repeat(3000)}`.slice(-2000),
    })
    expect(r.tabs[1]?.tail as string).toHaveLength(2000)
  })

  test("an unknown task is an error, not an empty result", async () => {
    const { api } = fakeApi({ collect: { tasks: [] } })
    await expect(TASK_OPS["task.info"]?.run({ taskId: T }, { api })).rejects.toMatchObject({ code: "NOT_FOUND" })
  })
})

describe("repo-scoped reads", () => {
  test("repo.branches serves a known repo through the git helpers", async () => {
    taskOpDeps.listLocalBranches = (r) => (r === REPO ? ["main", "dev"] : [])
    taskOpDeps.getCurrentBranch = () => "dev"
    const { result, calls } = await run("repo.branches", { repo: REPO })
    expect(result).toEqual({ branches: ["main", "dev"], current: "dev" })
    expect(calls).toEqual([{ rpc: "task.list", payload: undefined }])
  })

  test("a saved project counts as known even with no tasks", async () => {
    taskOpDeps.savedRepos = () => ["/work/saved"]
    taskOpDeps.listLocalBranches = () => ["main"]
    taskOpDeps.getCurrentBranch = () => null
    const { result } = await run("repo.branches", { repo: "/work/saved" })
    expect(result).toEqual({ branches: ["main"], current: null })
  })

  test("unknown or relative repos are refused for every repo-scoped op", async () => {
    for (const op of ["repo.branches", "notes.list", "worktree.adoptable", "project.forget"]) {
      await refused(op, { repo: "/etc" })
      await refused(op, { repo: "payments-api" })
      await refused(op, { repo: "--force" })
    }
    await refused("notes.delete", { repo: "/etc", id: 1 })
  })

  test("notes.list wraps note-list", async () => {
    const { result, calls } = await run(
      "notes.list",
      { repo: REPO },
      { "note-list": { notes: [{ id: 4, text: "x", at: 1 }] } },
    )
    expect(calls.at(-1)).toEqual({ verb: "note-list", argv: [`--repo=${REPO}`] })
    expect(result).toEqual({ notes: [{ id: 4, text: "x", at: 1 }] })
  })

  test("worktree.adoptable wraps the discover RPC", async () => {
    const { result, calls } = await run(
      "worktree.adoptable",
      { repo: REPO },
      { "worktree.discoverAdoptable": { worktrees: [{ path: "/w/a", branch: "a" }], unreadable: ["/w/x"] } },
    )
    expect(calls.at(-1)).toEqual({ rpc: "worktree.discoverAdoptable", payload: { repo: REPO } })
    expect(result).toEqual({ worktrees: [{ path: "/w/a", branch: "a" }], unreadable: ["/w/x"] })
  })
})

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
    ["task.rename", { taskId: T, title: "--new" }, { verb: "rename", argv: [`--task-id=${T}`, "--title=--new"] }],
    [
      "task.setBranch",
      { taskId: T, branch: "feat/y" },
      { verb: "set-branch", argv: [`--task-id=${T}`, "--branch=feat/y"] },
    ],
    [
      "task.setModel",
      { taskId: T, model: "gpt-5.1:high" },
      { verb: "set-model", argv: [`--task-id=${T}`, "--model=gpt-5.1:high"] },
    ],
    [
      "task.setEffort",
      { taskId: T, level: "xhigh" },
      { verb: "set-effort", argv: [`--task-id=${T}`, "--level=xhigh"] },
    ],
    [
      "task.setStatus",
      { taskId: T, status: "done" },
      { verb: "set-status", argv: [`--task-id=${T}`, "--status=done"] },
    ],
    ["task.pin", { taskId: T, pinned: false }, { verb: "pin", argv: [`--task-id=${T}`, "--pinned=false"] }],
    ["task.pin", { taskId: T, pinned: true }, { verb: "pin", argv: [`--task-id=${T}`, "--pinned=true"] }],
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
      { "set-command": { ok: true, command: "codex", protocol: "codex" } },
    )
    expect(calls.at(-1)).toEqual({ verb: "set-command", argv: [`--task-id=${T}`, "--command=codex"] })
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
