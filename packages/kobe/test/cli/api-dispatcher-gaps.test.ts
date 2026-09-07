/**
 * The dispatcher-facing half of `rove api`: `watch`, the worker report, and
 * the named worktree.
 *
 * Each of these exists because a supervisor could not otherwise SEE something
 * — when a worker died, what it delivered, where its files are — so the
 * assertions here are about what reaches the caller, not about internal
 * state. Delete's branch report has its own file (it needs a real git repo);
 * `interrupt`'s live path needs a pty host and is covered by the PR's
 * recorded runs.
 */

import { describe, expect, it } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { FakeClient, expectApiError, stubRuntime, taskFixture } from "./api-handler-fixtures.ts"

const runtime = stubRuntime()

/** `watch` writes NDJSON straight to stdout; capture it rather than the console. */
async function captureStdout<T>(fn: () => Promise<T>): Promise<{ result: T; lines: unknown[] }> {
  const written: string[] = []
  const original = process.stdout.write.bind(process.stdout)
  // biome-ignore lint/suspicious/noExplicitAny: the write overload set is not worth reproducing
  process.stdout.write = ((chunk: any) => {
    written.push(String(chunk))
    return true
  }) as typeof process.stdout.write
  try {
    const result = await fn()
    return {
      result,
      lines: written
        .join("")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l)),
    }
  } finally {
    process.stdout.write = original
  }
}

describe("watch", () => {
  const event = (over: Record<string, unknown> = {}) => ({
    taskId: "t1",
    tabId: "tab-1",
    state: "running",
    at: 1000,
    ...over,
  })

  it("streams one line per transition and stops at the first --until state", async () => {
    const client = new FakeClient()
    // The daemon publishes a transition at tab level AND as a task-level
    // rollup, so a real stream interleaves the two shapes.
    client.replay.push(
      { channel: "engine-state", payload: event() as never },
      { channel: "engine-state", payload: event({ tabId: undefined }) as never },
      { channel: "engine-state", payload: event({ state: "dead", at: 2000 }) as never },
    )
    const { result, lines } = await captureStdout(() =>
      invokeVerb("watch", ["--task-ids", "t1", "--until", "dead"], { client, runtime }),
    )
    expect(lines).toEqual([
      { taskId: "t1", tabId: "tab-1", state: "running", at: 1000 },
      { taskId: "t1", state: "running", at: 1000 },
      { taskId: "t1", tabId: "tab-1", state: "dead", at: 2000 },
    ])
    expect(result).toMatchObject({ ok: true, events: 3, matched: { taskId: "t1", state: "dead" } })
  })

  it("prints one line per DISTINCT event, even when an unrelated publish separates two identical ones", async () => {
    // The bug this pins: comparing only against the previous line let the
    // third publish through, because the task-level rollup sat between two
    // byte-identical tab-level events and a caller counting lines saw two
    // turn-starts where the engine had one.
    const client = new FakeClient()
    client.replay.push(
      { channel: "engine-state", payload: event() as never },
      { channel: "engine-state", payload: event({ tabId: undefined }) as never },
      { channel: "engine-state", payload: event() as never },
      { channel: "engine-state", payload: event({ state: "dead", at: 2000 }) as never },
    )
    const { lines } = await captureStdout(() =>
      invokeVerb("watch", ["--task-ids", "t1", "--until", "dead"], { client, runtime }),
    )
    expect(lines).toHaveLength(3)
  })

  it("ignores tasks it was not asked to watch", async () => {
    const client = new FakeClient()
    client.replay.push(
      { channel: "engine-state", payload: event({ taskId: "other", state: "dead" }) as never },
      { channel: "engine-state", payload: event({ state: "dead", at: 2000 }) as never },
    )
    const { lines } = await captureStdout(() =>
      invokeVerb("watch", ["--task-ids", "t1", "--until", "dead"], { client, runtime }),
    )
    expect(lines).toEqual([{ taskId: "t1", tabId: "tab-1", state: "dead", at: 2000 }])
  })

  it("refuses a state that does not exist, instead of waiting forever for it", async () => {
    // The worst failure mode for a verb whose whole job is to wait: a typo
    // that cannot ever match reads exactly like a task that is taking a while.
    await expectApiError(
      () => invokeVerb("watch", ["--task-ids", "t1", "--until", "died"], { client: new FakeClient(), runtime }),
      "BAD_FLAG",
      /died/,
    )
  })

  it("times out with the state it was waiting for, not silence", async () => {
    await expectApiError(
      () =>
        invokeVerb("watch", ["--task-ids", "t1", "--until", "dead", "--timeout", "30"], {
          client: new FakeClient(),
          runtime,
        }),
      "WATCH_TIMEOUT",
      /dead/,
    )
  })

  it("needs a target", async () => {
    await expectApiError(
      () => invokeVerb("watch", ["--until", "dead"], { client: new FakeClient(), runtime }),
      "MISSING_TARGET",
    )
  })
})

describe("set-status --report-*", () => {
  it("carries the worker's claim alongside the status, in one call", async () => {
    const client = new FakeClient({ "task.status": () => ({}) })
    await invokeVerb(
      "set-status",
      [
        "--task-id",
        "t1",
        "--status",
        "done",
        "--report-branch",
        "fix/x",
        "--report-pr",
        "921",
        "--report-summary",
        "did it",
      ],
      { client, runtime },
    )
    expect(client.requests[0]?.payload).toEqual({
      taskId: "t1",
      status: "done",
      reportBranch: "fix/x",
      reportPr: 921,
      reportSummary: "did it",
    })
  })

  it("sends no report fields when none were given", async () => {
    // An empty report would restamp `at` and tell a dispatcher the worker
    // reported again when it only moved the status.
    const client = new FakeClient({ "task.status": () => ({}) })
    await invokeVerb("set-status", ["--task-id", "t1", "--status", "done"], { client, runtime })
    expect(client.requests[0]?.payload).toEqual({
      taskId: "t1",
      status: "done",
      reportBranch: undefined,
      reportPr: undefined,
      reportSummary: undefined,
    })
  })
})

describe("add --worktree-name", () => {
  it("passes the chosen directory name through to the create", async () => {
    const client = new FakeClient({ "task.create": () => ({ taskId: "t1", task: taskFixture() }) })
    await invokeVerb("add", ["--repo", "/repo/x", "--worktree-name", "probe-1"], { client, runtime })
    expect(client.requests[0]?.payload).toMatchObject({ worktreeName: "probe-1" })
  })

  it("refuses to share one directory name across a parallel round", async () => {
    await expectApiError(
      () =>
        invokeVerb("add", ["--repo", "/repo/x", "--count", "2", "--prompt", "hi", "--worktree-name", "probe-1"], {
          client: new FakeClient(),
          runtime,
        }),
      "BAD_FLAG",
      /--worktree-name names ONE directory/,
    )
  })
})
