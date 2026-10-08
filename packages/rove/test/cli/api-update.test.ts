/**
 * `update` — the one task-metadata verb. What a caller relies on: every field
 * validated before anything is written, writes in a fixed order with the
 * git-side branch rename first, and a mid-way refusal that names what
 * already applied instead of looking like nothing happened.
 */

import { describe, expect, it } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { ApiError } from "../../src/cli/api/types.ts"
import { FakeClient, expectApiError, stubRuntime } from "./api-handler-fixtures.ts"

const ok = () => ({})
const writes = {
  "task.setBranch": ok,
  "task.setCommand": ok,
  "task.setVendor": ok,
  "task.rename": ok,
  "task.pin": ok,
  "task.status": ok,
}

describe("update", () => {
  it("applies several fields in one call, branch first, and reports them in write order", async () => {
    const client = new FakeClient({ "task.get": () => ({ task: { id: "t1", vendor: "claude" } }), ...writes })
    const out = await invokeVerb(
      "update",
      [
        "--task-id",
        "t1",
        "--title",
        "New",
        "--pinned",
        "false",
        "--command",
        "codex --search",
        "--effort",
        "high",
        "--branch",
        "feat/x",
      ],
      { client, runtime: stubRuntime() },
    )
    expect(client.requests.map((r) => r.name)).toEqual([
      "task.get",
      "task.setBranch",
      "task.setCommand",
      "task.setVendor",
      "task.rename",
      "task.pin",
    ])
    // The effort is judged against, and recorded on, the engine the new command runs.
    expect(client.requests[3]?.payload).toEqual({ taskId: "t1", vendor: "codex", effort: "high" })
    expect(client.requests[5]?.payload).toEqual({ taskId: "t1", pinned: false })
    expect(out).toMatchObject({
      updated: ["branch", "command", "effort", "title", "pinned"],
      protocol: "codex",
      engine: "codex",
    })
  })

  it("writes nothing when any field is invalid", async () => {
    const client = new FakeClient({ "task.get": () => ({ task: { id: "t1", vendor: "claude" } }), ...writes })
    await expectApiError(
      () =>
        invokeVerb("update", ["--task-id", "t1", "--branch", "feat/x", "--effort", "high"], {
          client,
          runtime: stubRuntime(),
        }),
      "BAD_EFFORT",
    )
    expect(client.requests.map((r) => r.name)).toEqual(["task.get"])
  })

  it("a refusal after a write names what already applied", async () => {
    const client = new FakeClient({
      ...writes,
      "task.rename": () => {
        throw new Error("task gone")
      },
    })
    try {
      await invokeVerb("update", ["--task-id", "t1", "--branch", "feat/x", "--title", "New"], {
        client,
        runtime: stubRuntime(),
      })
      expect.unreachable("should have thrown")
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).message).toMatch(/--title failed after branch applied/)
      expect((err as ApiError).data).toMatchObject({ applied: ["branch"], failed: ["title"] })
    }
  })

  it("records a worker report only together with a status", async () => {
    const client = new FakeClient(writes)
    await expectApiError(
      () => invokeVerb("update", ["--task-id", "t1", "--report-pr", "12"], { client, runtime: stubRuntime() }),
      "BAD_FLAG",
      /--status/,
    )
    expect(client.requests).toEqual([])
  })

  it("refuses an empty update instead of reporting success", async () => {
    await expectApiError(
      () => invokeVerb("update", ["--task-id", "t1"], { client: new FakeClient(writes), runtime: stubRuntime() }),
      "BAD_FLAG",
      /nothing to update/,
    )
  })

  it("--tab renames only the tab and refuses task fields beside it", async () => {
    const client = new FakeClient(writes)
    await expectApiError(
      () =>
        invokeVerb("update", ["--task-id", "t1", "--tab", "tab-2", "--title", "x", "--branch", "b"], {
          client,
          runtime: stubRuntime(),
        }),
      "BAD_FLAG",
      /--tab only renames a tab/,
    )
    expect(client.requests).toEqual([])
  })
})

describe("folded update flags on issues and routines", () => {
  it("issue-update --status rides its own setStatus op after the field update", async () => {
    const client = new FakeClient({ "issue.mutate": () => ({ issues: [] }) })
    await invokeVerb("issue-update", ["--repo", "/repo/x", "--id", "7", "--title", "T", "--status", "done"], {
      client,
      runtime: stubRuntime(),
    })
    expect(client.requests.map((r) => (r.payload as { op: { type: string } }).op.type)).toEqual(["update", "setStatus"])
  })

  it("routine-update --enabled false pauses the routine", async () => {
    const client = new FakeClient({ "automation.update": () => ({}) })
    await invokeVerb("routine-update", ["--id", "r1", "--enabled", "false"], { client, runtime: stubRuntime() })
    expect(client.requests).toEqual([{ name: "automation.update", payload: { id: "r1", enabled: false } }])
  })
})
