import { describe, expect, it } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { FakeClient, expectApiError, stubRuntime } from "./api-handler-fixtures.ts"

const after = {
  notes: "n",
  todos: [
    { id: "t1", text: "a", done: true },
    { id: "t2", text: "b", done: false },
  ],
}

describe("todo", () => {
  it("with no flag only reads, and reports done over total", async () => {
    const client = new FakeClient({ "task.notes": () => after })
    const out = await invokeVerb("todo", ["--task-id", "t1"], { client, runtime: stubRuntime() })
    expect(client.requests).toEqual([{ name: "task.notes", payload: { taskId: "t1" } }])
    expect(out).toMatchObject({ ok: true, notes: "n", done: 1, total: 2 })
  })

  it("sends every flag as one call, ops in the documented order", async () => {
    const client = new FakeClient({ "task.notes": () => after })
    await invokeVerb(
      "todo",
      ["--task-id", "t1", "--remove", "t2", "--add", "x", "--uncheck", "t1", "--check", "t2", "--clear-notes"],
      { client, runtime: stubRuntime() },
    )
    expect(client.requests).toEqual([
      {
        name: "task.notes",
        payload: {
          taskId: "t1",
          notes: "",
          ops: [
            { op: "add", text: "x" },
            { op: "check", id: "t2", done: true },
            { op: "check", id: "t1", done: false },
            { op: "remove", id: "t2" },
          ],
        },
      },
    ])
  })

  it("--edit and --text must come together", async () => {
    const client = new FakeClient({ "task.notes": () => after })
    await expectApiError(
      () => invokeVerb("todo", ["--task-id", "t1", "--edit", "t1"], { client, runtime: stubRuntime() }),
      "BAD_FLAG",
    )
    expect(client.requests).toEqual([])
  })
})
