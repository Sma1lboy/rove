/** `add --start` without a `--prompt`: the task's engine boots idle in its own tab-1. A bare `add` creates nothing. */

import { describe, expect, it } from "vitest"
import { ApiError, invokeVerb } from "../../src/cli/api-cmd.ts"
import { FakeClient, stubRuntime, taskFixture } from "./api-handler-fixtures.ts"

const created = () => ({ taskId: "t1", task: taskFixture() })

describe("add --start", () => {
  it("opens tab-1 and starts the engine idle", async () => {
    const client = new FakeClient({ "task.create": created })
    const opened: Array<{ id: string; kind: string }> = []
    const result = await invokeVerb("add", ["--repo", "/repo/x", "--start"], {
      client,
      runtime: stubRuntime({
        openTab: async (_client, target, kind) => {
          opened.push({ id: target.id, kind })
          return { tab: { kind: "engine", id: "tab-1", title: null, ordinal: 1 }, session: "t1::tab-1" }
        },
      }),
    })

    expect(opened).toEqual([{ id: "t1", kind: "engine" }])
    expect(result).toMatchObject({ taskId: "t1", started: true, tabId: "tab-1", session: "t1::tab-1" })
  })

  it("keeps the task it created and names it when the engine does not start", async () => {
    const client = new FakeClient({ "task.create": created })
    const err = await invokeVerb("add", ["--repo", "/repo/x", "--start"], {
      client,
      runtime: stubRuntime({
        openTab: async () => {
          throw new ApiError("engine cap reached", "ENGINE_LIMIT")
        },
      }),
    }).catch((e: unknown) => e)

    expect(err).toMatchObject({ code: "ENGINE_LIMIT", data: { taskId: "t1" } })
    expect(client.requestNames).toEqual(["task.create"])
  })

  it.each([
    ["--prompt", ["--prompt", "do it"]],
    ["--count", ["--count", "2", "--prompt", "do it"]],
  ])("refuses --start beside %s", async (_name, extra) => {
    const client = new FakeClient({ "task.create": created })
    const err = await invokeVerb("add", ["--repo", "/repo/x", "--start", ...extra], {
      client,
      runtime: stubRuntime(),
    }).catch((e: unknown) => e)

    expect(err).toMatchObject({ code: "CONFLICTING_FLAGS" })
    expect(client.requestNames).toEqual([])
  })
})

describe("add --worktree-only", () => {
  it("cuts the checkout, marks it, and starts no engine", async () => {
    const client = new FakeClient({
      "task.create": created,
      "task.ensureWorktree": () => ({ worktreePath: "/wt/made" }),
      "task.worktreeOnly": () => ({}),
      "task.get": () => ({ task: taskFixture({ worktreePath: "/wt/made", worktreeOnly: true }) }),
    })
    const result = await invokeVerb("add", ["--repo", "/repo/x", "--worktree-only"], {
      client,
      runtime: stubRuntime({
        openTab: async () => {
          throw new Error("--worktree-only must not start an engine")
        },
      }),
    })

    // Marked in the create and again before the cut, so the row is never listed while git works.
    expect(client.requestNames).toEqual(["task.create", "task.worktreeOnly", "task.ensureWorktree", "task.get"])
    expect(client.requests[0]?.payload).toMatchObject({ worktreeOnly: true })
    expect(result).toMatchObject({ taskId: "t1", started: false, worktreePath: "/wt/made" })
  })

  it("a cut that fails takes the mark off, leaving a row the user can see and delete", async () => {
    const marks: unknown[] = []
    const client = new FakeClient({
      "task.create": created,
      "task.worktreeOnly": (payload) => {
        marks.push((payload as { on?: boolean }).on)
        return {}
      },
      "task.ensureWorktree": () => {
        throw new Error("git worktree add failed")
      },
    })
    await expect(
      invokeVerb("add", ["--repo", "/repo/x", "--worktree-only"], { client, runtime: stubRuntime({}) }),
    ).rejects.toThrow("git worktree add failed")
    expect(marks).toEqual([true, false])
  })

  it("refuses --worktree-only beside --start", async () => {
    const client = new FakeClient({ "task.create": created })
    const err = await invokeVerb("add", ["--repo", "/repo/x", "--worktree-only", "--start"], {
      client,
      runtime: stubRuntime({}),
    }).catch((e: unknown) => e)

    expect(err).toMatchObject({ code: "CONFLICTING_FLAGS" })
    expect(client.requestNames).toEqual([])
  })
})

describe("a bare add", () => {
  it("is refused for every caller before anything is created, naming the three ways to say what to run", async () => {
    const client = new FakeClient({ "task.create": created })
    const err = await invokeVerb("add", ["--repo", "/repo/x", "--title", "scratch"], {
      client,
      runtime: stubRuntime(),
    }).catch((e: unknown) => e)

    expect(err).toMatchObject({ code: "EMPTY_SESSION" })
    expect((err as Error).message).toMatch(/--prompt.*--start.*--worktree-only/)
    expect(client.requestNames).toEqual([])
  })
})
