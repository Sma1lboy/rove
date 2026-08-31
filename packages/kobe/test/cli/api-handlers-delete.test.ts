/**
 * Request-traffic tests for `api delete`.
 *
 * Split out of `api-handlers-lifecycle.test.ts` (file-size cap). These cover
 * one question the rest of the lifecycle suite does not: a delete has THREE
 * outcomes — queued, refused, and queued-then-failed — and each must reach
 * the caller as a different reply. They used to be one indistinguishable
 * empty object, with a failed worktree removal recorded only in `daemon.log`.
 */

import { describe, expect, it } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { FakeClient, expectApiError, recordingTearDown, stubRuntime, taskFixture } from "./api-handler-fixtures.ts"

describe("task delete handler", () => {
  it("deletes before stopping orphaned hosted sessions", async () => {
    const order: string[] = []
    const client = new FakeClient({
      "task.delete": () => {
        order.push("rpc")
        return { taskId: "t1", queued: true }
      },
    })
    const { killed, tearDownSession } = recordingTearDown()
    await invokeVerb("delete", ["--task-id", "t1", "--force"], {
      client,
      runtime: stubRuntime({
        tearDownSession: async (id) => {
          order.push("kill")
          await tearDownSession(id)
        },
      }),
    })
    expect(killed).toEqual(["t1"])
    expect(order).toEqual(["rpc", "kill"])
  })

  it("keeps the branch by default and passes --delete-branch through as opt-in", async () => {
    const client = new FakeClient({ "task.delete": () => ({ taskId: "t1", queued: true }) })
    const { tearDownSession } = recordingTearDown()
    await invokeVerb("delete", ["--task-id", "t1"], { client, runtime: stubRuntime({ tearDownSession }) })
    expect(client.requests[0].payload).toEqual({ taskId: "t1", force: false, deleteBranch: false })

    await invokeVerb("delete", ["--task-id", "t1", "--delete-branch"], {
      client,
      runtime: stubRuntime({ tearDownSession }),
    })
    expect(client.requests[1].payload).toEqual({ taskId: "t1", force: false, deleteBranch: true })
  })

  // Requirement of this change: the three outcomes of a delete must be three
  // different replies. Queued-then-FAILED is the one that used to be
  // unreachable — `finish()` wrote the git error to the task record and
  // `daemon.log`, and the caller got the same `{}` a success returned.
  it("--wait reports a background removal that failed, with the git error", async () => {
    const client = new FakeClient({
      "task.delete": () => ({ taskId: "t1", queued: true }),
      "task.list": () => ({
        tasks: [
          taskFixture({
            id: "t1",
            deletion: {
              phase: "error",
              force: true,
              requestedAt: "2026-08-31T00:00:00.000Z",
              error: "boom: Directory not empty",
            },
          }),
        ],
      }),
    })
    const { tearDownSession } = recordingTearDown()
    const result = await invokeVerb("delete", ["--task-id", "t1", "--force", "--wait"], {
      client,
      runtime: stubRuntime({ tearDownSession }),
    })
    expect(result).toMatchObject({ queued: true, status: "failed", error: "boom: Directory not empty" })
  })

  it("--wait reports a background removal that succeeded", async () => {
    const client = new FakeClient({
      "task.delete": () => ({ taskId: "t1", queued: true }),
      "task.list": () => ({ tasks: [] }),
    })
    const { tearDownSession } = recordingTearDown()
    const result = await invokeVerb("delete", ["--task-id", "t1", "--force", "--wait"], {
      client,
      runtime: stubRuntime({ tearDownSession }),
    })
    expect(result).toMatchObject({ queued: true, status: "removed" })
  })

  // A removal that failed must not be reportable as one that worked. Comparing
  // the two replies is what breaks if the outcome ever stops reaching the
  // caller, whatever the field is named.
  it("a failed removal and a successful one are not the same reply", async () => {
    const { tearDownSession } = recordingTearDown()
    const runtime = () => stubRuntime({ tearDownSession })
    const failed = await invokeVerb("delete", ["--task-id", "t1", "--force", "--wait"], {
      client: new FakeClient({
        "task.delete": () => ({ taskId: "t1", queued: true }),
        "task.list": () => ({
          tasks: [
            taskFixture({
              id: "t1",
              deletion: { phase: "error", force: true, requestedAt: "2026-08-31T00:00:00.000Z", error: "nope" },
            }),
          ],
        }),
      }),
      runtime: runtime(),
    })
    const removed = await invokeVerb("delete", ["--task-id", "t1", "--force", "--wait"], {
      client: new FakeClient({
        "task.delete": () => ({ taskId: "t1", queued: true }),
        "task.list": () => ({ tasks: [] }),
      }),
      runtime: runtime(),
    })
    expect(failed).not.toEqual(removed)
  })

  // Without --wait the caller gets the fast path, and it must still say which
  // of the two synchronous outcomes happened rather than a bare `{}`.
  it("without --wait, a refused delete does not look like an accepted one", async () => {
    const { tearDownSession } = recordingTearDown()
    const accepted = await invokeVerb("delete", ["--task-id", "t1", "--force"], {
      client: new FakeClient({ "task.delete": () => ({ taskId: "t1", queued: true }) }),
      runtime: stubRuntime({ tearDownSession }),
    })
    const refused = await invokeVerb("delete", ["--task-id", "gone", "--force"], {
      client: new FakeClient({ "task.delete": () => ({ taskId: "gone", queued: false }) }),
      runtime: stubRuntime({ tearDownSession }),
    })
    expect(accepted).not.toEqual(refused)
    expect(accepted).toMatchObject({ queued: true, status: "queued" })
    expect(refused).toMatchObject({ queued: false, status: "not_found" })
  })

  it("does not stop hosted sessions when the delete RPC is refused (dirty worktree)", async () => {
    // Non-force delete of a dirty worktree: the daemon's preflight rejects
    // the RPC, so the CLI-side session teardown (which runs AFTER the RPC)
    // must never fire — the session stays alive alongside the surviving
    // worktree instead of the worst-of-both dead-session/live-worktree state.
    const client = new FakeClient({
      "task.delete": () => {
        throw new Error("refused: DIRTY_WORKTREE")
      },
    })
    const { killed, tearDownSession } = recordingTearDown()
    await expect(
      invokeVerb("delete", ["--task-id", "t1"], { client, runtime: stubRuntime({ tearDownSession }) }),
    ).rejects.toThrow("DIRTY_WORKTREE")
    expect(killed).toEqual([])
  })
})
