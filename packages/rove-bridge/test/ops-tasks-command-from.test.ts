import { describe, expect, test } from "bun:test"
import { TASK_OPS } from "../src/ops/tasks.ts"
import { REPO, T, fakeApi, isolateTaskOpDeps, refused, run } from "./task-ops-harness.ts"

isolateTaskOpDeps()

const SOURCE = { "get-task": { task: { vendor: "claude", command: "/opt/stub/claude --flag" } } }
const ADD = { add: { taskId: "N1", task: {} } }

describe("task.spawn commandFrom", () => {
  test("starts on the source task's own launch command, read on this Mac, not the bare engine id", async () => {
    const { calls } = await run(
      "task.spawn",
      { repo: REPO, engine: "claude", prompt: "p", commandFrom: T },
      { ...SOURCE, ...ADD },
    )
    const add = calls.find((c) => "verb" in c && c.verb === "add")
    expect(add).toEqual({ verb: "add", argv: [`--repo=${REPO}`, "--command=/opt/stub/claude --flag", "--prompt=p"] })
    expect(calls).toContainEqual({ verb: "get-task", argv: [`--task-id=${T}`] })
  })

  test("a different engine than the source's runs is refused before anything is created", async () => {
    const { api, calls } = fakeApi({
      "engine-list": { engines: [{ id: "claude" }, { id: "codex" }] },
      ...SOURCE,
      ...ADD,
    })
    await expect(
      TASK_OPS["task.spawn"]?.run({ repo: REPO, engine: "codex", commandFrom: T }, { api }),
    ).rejects.toMatchObject({ code: "BAD_ARGS" })
    expect(calls.some((c) => "verb" in c && c.verb === "add")).toBe(false)
  })

  test("never with a machine, a parallel round, no engine, or a malformed task id", async () => {
    await refused("task.spawn", { repo: "/Users/me/app", machine: "mac", engine: "claude", commandFrom: T }, SOURCE)
    await refused("task.spawn", { repo: REPO, agents: "claude:2", prompt: "p", commandFrom: T }, SOURCE)
    await refused("task.spawn", { repo: REPO, count: 2, engine: "claude", prompt: "p", commandFrom: T }, SOURCE)
    await refused("task.spawn", { repo: REPO, commandFrom: T }, SOURCE)
    await refused("task.spawn", { repo: REPO, engine: "claude", commandFrom: "--command=rm" }, SOURCE)
  })
})

describe("task.get extraRepos", () => {
  test("lists a multi-repo task's other repos in pick order with the ref each was cut from", async () => {
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
            worktreePath: "/w",
            status: "backlog",
            createdAt: "c",
            updatedAt: "u",
            extraRepos: [
              { name: "api", repo: "/work/api", branch: "b", worktreePath: "/w/api", baseRef: "release" },
              { name: "web", repo: "/work/web", branch: "b", worktreePath: "" },
            ],
          },
        },
      },
    )
    expect((result as { task: { extraRepos: unknown } }).task.extraRepos).toEqual([
      { repo: "/work/api", baseRef: "release" },
      { repo: "/work/web" },
    ])
  })
})
