import { describe, expect, test } from "bun:test"
import { AREA_OPS } from "../src/ops/index.ts"
import { taskOpDeps } from "../src/ops/tasks-shared.ts"
import { TASK_OPS } from "../src/ops/tasks.ts"
import { REPO, T, fakeApi, isolateTaskOpDeps, refused, run } from "./task-ops-harness.ts"

isolateTaskOpDeps()

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
