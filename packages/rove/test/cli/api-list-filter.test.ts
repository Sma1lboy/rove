/** `list --repo/--status/--activity`: the "which tasks need me" read without a jq pipeline. */

import { describe, expect, it } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { FakeClient, expectApiError, stubRuntime, taskFixture } from "./api-handler-fixtures.ts"

const now = Date.now()

function fleet() {
  return new FakeClient({
    "task.list": () => ({
      activeTaskId: "blocked",
      tasks: [
        taskFixture({ id: "blocked", status: "in_progress" }),
        taskFixture({ id: "failed", status: "in_progress" }),
        taskFixture({ id: "busy", status: "in_progress" }),
        taskFixture({ id: "parked", status: "backlog", repo: "/repo/y" }),
        taskFixture({ id: "never-started", status: "backlog" }),
      ],
    }),
    "debug.inspect": () => ({
      activity: {
        tasks: {
          blocked: { state: "permission_needed", at: now },
          failed: { state: "error", at: now, detail: { note: "boom" } },
          busy: { state: "running", at: now },
          parked: { state: "permission_needed", at: now },
        },
      },
    }),
  })
}

async function ids(argv: string[]): Promise<{ ids: string[]; result: Record<string, unknown> }> {
  const result = (await invokeVerb("list", argv, { client: fleet(), runtime: stubRuntime() })) as {
    tasks: Array<{ id: string }>
  }
  return { ids: result.tasks.map((t) => t.id), result }
}

describe("list filters", () => {
  it.each([
    { flag: "--activity", value: "permission_needed", remoteMatches: false },
    { flag: "--status", value: "in_progress", remoteMatches: true },
  ])("$flag respects task origins when IDs collide", async ({ flag, value, remoteMatches }) => {
    const tasks = ["local", "remote-host"].map((machineId) =>
      taskFixture({
        id: "same-id",
        status: "in_progress",
        origin: { machineId, hostLabel: machineId },
      }),
    )
    const client = new FakeClient({
      "task.list": () => ({ tasks }),
      "debug.inspect": () => ({ activity: { tasks: { "same-id": { state: "permission_needed", at: now } } } }),
    })
    const result = await invokeVerb("list", [flag, value], { client, runtime: stubRuntime() })
    expect(result).toEqual({
      tasks: remoteMatches
        ? tasks
        : [
            {
              ...tasks[0],
              activity: { state: "permission_needed", at: new Date(now).toISOString(), forMs: expect.any(Number) },
            },
          ],
    })
  })

  it("--activity lists the tasks waiting on a human, with the state that matched", async () => {
    const { ids: got, result } = await ids(["--activity", "permission_needed,error"])
    expect(got).toEqual(["blocked", "failed", "parked"])
    const tasks = result.tasks as Array<{ activity: { state: string } }>
    expect(tasks.map((t) => t.activity.state)).toEqual(["permission_needed", "error", "permission_needed"])
    expect(result.activeTaskId).toBe("blocked")
  })

  it("filters AND together, and a task with no readable state never matches", async () => {
    expect((await ids(["--repo", "/repo/x", "--activity", "permission_needed"])).ids).toEqual(["blocked"])
    expect((await ids(["--status", "backlog"])).ids).toEqual(["parked", "never-started"])
    expect((await ids(["--status", "backlog", "--activity", "idle,running"])).ids).toEqual([])
  })

  it("refuses a value outside the vocabulary instead of matching nothing", async () => {
    await expectApiError(
      () => invokeVerb("list", ["--activity", "blocked"], { client: fleet(), runtime: stubRuntime() }),
      "BAD_FLAG",
      /permission_needed/,
    )
    await expectApiError(
      () => invokeVerb("list", ["--status", "todo"], { client: fleet(), runtime: stubRuntime() }),
      "BAD_FLAG",
      /in_progress/,
    )
  })
})

describe("list repoCount", () => {
  it("counts every repo (primary included) on a multi-repo task and leaves one-repo rows alone", async () => {
    const extra = { name: "api", repo: "/api", branch: "b", worktreePath: "/wt/api" }
    const client = new FakeClient({
      "task.list": () => ({
        tasks: [
          taskFixture({ id: "multi", extraRepos: [extra, { ...extra, name: "web" }] }),
          taskFixture({ id: "one" }),
        ],
      }),
    })
    const result = (await invokeVerb("list", [], { client, runtime: stubRuntime() })) as {
      tasks: Array<{ id: string; repoCount?: number }>
    }
    expect(result.tasks.map((t) => [t.id, t.repoCount])).toEqual([
      ["multi", 3],
      ["one", undefined],
    ])
    expect(result.tasks[1]).not.toHaveProperty("repoCount")
  })
})

describe("list --archived", () => {
  const client = () =>
    new FakeClient({
      "task.list": () => ({
        tasks: [
          taskFixture({ id: "live", status: "in_progress" }),
          taskFixture({ id: "hidden", status: "in_progress", archived: true }),
          taskFixture({ id: "hidden-done", status: "done", archived: true }),
        ],
      }),
    })
  const listed = async (argv: string[]) =>
    (
      (await invokeVerb("list", argv, { client: client(), runtime: stubRuntime() })) as { tasks: Array<{ id: string }> }
    ).tasks.map((t) => t.id)

  it("leaves archived tasks out by default and lists only them with --archived", async () => {
    expect(await listed([])).toEqual(["live"])
    expect(await listed(["--archived"])).toEqual(["hidden", "hidden-done"])
  })

  it("ANDs with the other filters", async () => {
    expect(await listed(["--archived", "--status", "done"])).toEqual(["hidden-done"])
  })
})
