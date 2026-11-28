/**
 * `watch --until` on PR states: a supervisor blocks on a task's PR (CI result,
 * merge, close, conflict) the way it blocks on engine states, fed by the
 * daemon's `task.snapshot` broadcasts of the polled `prStatus`.
 */

import { invokeVerb } from "@sma1lboy/rove-api/cli/api-cmd.ts"
import { afterEach, describe, expect, it, vi } from "vitest"
import { FakeClient, expectApiError, stubRuntime, taskFixture } from "./api-handler-fixtures.ts"

function snapshot(...tasks: Record<string, unknown>[]) {
  return { tasks } as never
}

function pr(overrides: Record<string, unknown>) {
  return { provider: "github", lifecycle: "open", checkState: "pending", number: 41, ...overrides }
}

function captureLines(): string[] {
  const lines: string[] = []
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    lines.push(...String(chunk).split("\n").filter(Boolean))
    return true
  })
  return lines
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("watch on PR states", () => {
  it("streams each newly entered PR state and stops at the first --until match", async () => {
    const lines = captureLines()
    const client = new FakeClient()
    client.replay.push({
      channel: "task.snapshot",
      payload: snapshot(
        taskFixture({ id: "t1", prStatus: pr({}) }),
        taskFixture({ id: "t2", prStatus: pr({ checkState: "failing" }) }),
      ),
    })
    const done = invokeVerb("watch", ["--task-ids", "t1", "--until", "ci_passing,ci_failing", "--timeout", "5000"], {
      client,
      runtime: stubRuntime(),
    })
    await vi.waitFor(() => expect(client.subscribeCount).toBe(1))
    // An unrelated change re-broadcasts t1 unchanged: no new line.
    client.emit("task.snapshot", snapshot(taskFixture({ id: "t1", title: "renamed", prStatus: pr({}) })))
    client.emit(
      "task.snapshot",
      snapshot(taskFixture({ id: "t1", prStatus: pr({ checkState: "failing", mergeable: "CONFLICTING" }) })),
    )

    await expect(done).resolves.toMatchObject({
      ok: true,
      events: 2,
      matched: { taskId: "t1", state: "ci_failing", pr: 41 },
    })
    expect(lines.map((line) => JSON.parse(line).state)).toEqual(["ci_pending", "ci_failing"])
  })

  it("matches at once when the PR is already merged", async () => {
    captureLines()
    const client = new FakeClient()
    client.replay.push({
      channel: "task.snapshot",
      payload: snapshot(taskFixture({ id: "t1", prStatus: pr({ lifecycle: "merged", checkState: "passing" }) })),
    })
    await expect(
      invokeVerb("watch", ["--task-ids", "t1", "--until", "pr_merged,pr_closed"], { client, runtime: stubRuntime() }),
    ).resolves.toMatchObject({ matched: { taskId: "t1", state: "pr_merged" } })
  })

  it("refuses a misspelled PR state instead of waiting forever", async () => {
    await expectApiError(
      () =>
        invokeVerb("watch", ["--task-ids", "t1", "--until", "pr_merge"], {
          client: new FakeClient(),
          runtime: stubRuntime(),
        }),
      "BAD_FLAG",
      /pr_merge.*valid:.*pr_merged/,
    )
  })
})
