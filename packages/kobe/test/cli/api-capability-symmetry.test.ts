/**
 * The four CLI halves that were missing while the TUI (or the create/read
 * side) already had them. Each test fails with its verb removed and with
 * nothing else, because each pins the ONE request the missing half has to
 * send — not the plumbing around it.
 *
 * - `issue-delete` — the kanban page's `d` runs the store's `delete` op; the
 *   CLI could only mark a story `done` and leave it.
 * - `delete --group` — create (`add --count`) and read (`collect --group`)
 *   are batched; closing the round was one call per loser.
 * - `remove-worktree` — `ensure-worktree` materializes without an engine and
 *   had no inverse, so reclaiming a checkout meant `delete`, which takes the
 *   task record too.
 * - `rename --tab` — a tab could be opened, closed, read and written from the
 *   CLI, but not named.
 */

import { describe, expect, it } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { mintCliTab, publishCliTabSnapshot, readTabsSnapshot } from "../../src/cli/api/tab-snapshot.ts"
import { FakeClient, expectApiError, recordingTearDown, stubRuntime, taskFixture } from "./api-handler-fixtures.ts"

describe("issue-delete", () => {
  it("sends the store's delete op, the same one the kanban page's `d` runs", async () => {
    const client = new FakeClient({ "issue.mutate": () => ({ issues: [], nextId: 4 }) })
    await invokeVerb("issue-delete", ["--repo", "/repo/x", "--id", "3"], { client, runtime: stubRuntime() })
    expect(client.requests).toEqual([
      { name: "issue.mutate", payload: { repoRoot: "/repo/x", op: { type: "delete", id: 3 } } },
    ])
  })
})

describe("delete --group", () => {
  const round = [
    taskFixture({ id: "a", groupId: "g1" }),
    taskFixture({ id: "b", groupId: "g1" }),
    taskFixture({ id: "c", groupId: "OTHER" }),
  ]

  it("deletes every sibling of the round and nothing outside it", async () => {
    const client = new FakeClient({
      "task.list": () => ({ tasks: round }),
      "task.delete": (payload) => ({ taskId: (payload as { taskId: string }).taskId, queued: true }),
    })
    const { killed, tearDownSession } = recordingTearDown()
    const res = (await invokeVerb("delete", ["--group", "g1"], {
      client,
      runtime: stubRuntime({ tearDownSession }),
    })) as { groupId: string; count: number; failures: number; results: Array<{ taskId: string; status: string }> }

    expect(res).toMatchObject({ groupId: "g1", count: 2, failures: 0 })
    expect(res.results.map((r) => r.taskId)).toEqual(["a", "b"])
    // The sibling in another round is never touched — the whole point of
    // selecting by groupId rather than by repo.
    expect(killed).toEqual(["a", "b"])
  })

  it("records a sibling's refusal instead of aborting the rest of the round", async () => {
    // A round routinely holds one dirty worktree. Throwing there would leave
    // the caller unable to tell which of N were already removed.
    const client = new FakeClient({
      "task.list": () => ({ tasks: round }),
      "task.delete": (payload) => {
        if ((payload as { taskId: string }).taskId === "a") throw new Error("DIRTY_WORKTREE: worktree has changes")
        return { taskId: "b", queued: true }
      },
    })
    const { tearDownSession } = recordingTearDown()
    const res = (await invokeVerb("delete", ["--group", "g1"], {
      client,
      runtime: stubRuntime({ tearDownSession }),
    })) as { failures: number; results: Array<{ taskId: string; status: string; code?: string; error?: string }> }

    expect(res.failures).toBe(1)
    expect(res.results[0]).toMatchObject({ taskId: "a", status: "failed", code: "DIRTY_WORKTREE" })
    // The survivor still ran — a partial round has to stay readable.
    expect(res.results[1]).toMatchObject({ taskId: "b", status: "queued" })
  })

  it("refuses a group nobody is in rather than reporting an empty success", async () => {
    const client = new FakeClient({ "task.list": () => ({ tasks: round }) })
    await expectApiError(
      () => invokeVerb("delete", ["--group", "nope"], { client, runtime: stubRuntime() }),
      "TASK_NOT_FOUND",
    )
  })

  it("rejects --task-id and --group together, and neither at all", async () => {
    const client = new FakeClient({})
    await expectApiError(
      () => invokeVerb("delete", ["--task-id", "a", "--group", "g1"], { client, runtime: stubRuntime() }),
      "BAD_FLAG",
    )
    await expectApiError(() => invokeVerb("delete", [], { client, runtime: stubRuntime() }), "MISSING_TARGET")
  })
})

describe("remove-worktree", () => {
  it("removes the DIRECTORY through the same RPC the Worktrees page uses, keeping task and branch", async () => {
    const client = new FakeClient({
      "task.get": () => ({ task: taskFixture({ id: "t1", worktreePath: "/wt/t1", branch: "feat/x" }) }),
      "worktree.remove": () => ({ removed: true }),
    })
    const res = await invokeVerb("remove-worktree", ["--task-id", "t1"], { client, runtime: stubRuntime() })
    // Routing through `worktree.remove` is the load-bearing part: that path
    // tears the session down first, salvages on force, and clears the task's
    // worktree pointer so `ensure-worktree` can re-materialize it.
    expect(client.requests[1]).toEqual({ name: "worktree.remove", payload: { path: "/wt/t1", force: false } })
    expect(res).toMatchObject({ taskId: "t1", worktreePath: "/wt/t1", branch: "feat/x", removed: true })
    // No `task.delete` anywhere: the record survives, which is the whole
    // difference from `delete`.
    expect(client.requests.some((r) => r.name === "task.delete")).toBe(false)
  })

  it("passes --force through so the removal path can salvage before discarding", async () => {
    const client = new FakeClient({
      "task.get": () => ({ task: taskFixture({ worktreePath: "/wt/t1" }) }),
      "worktree.remove": () => ({ removed: true }),
    })
    await invokeVerb("remove-worktree", ["--task-id", "t1", "--force"], { client, runtime: stubRuntime() })
    expect(client.requests[1]?.payload).toEqual({ path: "/wt/t1", force: true })
  })

  it("refuses the project's own checkout rather than deleting a user's repo", async () => {
    const client = new FakeClient({
      "task.get": () => ({ task: taskFixture({ repo: "/repo/x", worktreePath: "/repo/x" }) }),
    })
    await expectApiError(
      () => invokeVerb("remove-worktree", ["--task-id", "t1"], { client, runtime: stubRuntime() }),
      "BASE_CHECKOUT",
    )
  })

  it("refuses the worktree the caller is running from — an agent would delete its own cwd", async () => {
    const cwd = process.cwd()
    const client = new FakeClient({ "task.get": () => ({ task: taskFixture({ worktreePath: cwd }) }) })
    await expectApiError(
      () => invokeVerb("remove-worktree", ["--task-id", "t1"], { client, runtime: stubRuntime() }),
      "CALLER_WORKTREE",
    )
  })

  it("says so when the task never materialized one", async () => {
    const client = new FakeClient({ "task.get": () => ({ task: taskFixture({ worktreePath: "" }) }) })
    await expectApiError(
      () => invokeVerb("remove-worktree", ["--task-id", "t1"], { client, runtime: stubRuntime() }),
      "NO_WORKTREE",
    )
  })
})

describe("rename --tab", () => {
  /** Seed a real two-tab snapshot in the worker's isolated KOBE_HOME_DIR —
   *  the same writers the CLI's own launch path uses. */
  function seedTabs(taskId: string): string {
    publishCliTabSnapshot(taskId)
    return mintCliTab(taskId)
  }

  it("writes the persisted snapshot AND broadcasts, so headless and attached both land", async () => {
    // Both halves are needed and neither is a fallback: the write is the whole
    // rename with no TUI attached, the broadcast is what repaints an attached
    // one before its next tab mutation overwrites the file.
    const tabId = seedTabs("rename-both")
    const client = new FakeClient({ "terminalTab.rename": () => ({ ok: true, clients: 2 }) })
    const res = await invokeVerb("rename", ["--task-id", "rename-both", "--tab", tabId, "--title", "e2e"], {
      client,
      runtime: stubRuntime(),
    })
    expect(readTabsSnapshot("rename-both")?.tabs.find((t) => t.id === tabId)?.title).toBe("e2e")
    expect(client.requests).toEqual([
      { name: "terminalTab.rename", payload: { taskId: "rename-both", tabId, title: "e2e" } },
    ])
    expect(res).toMatchObject({ taskId: "rename-both", tabId, title: "e2e", renamed: true, clients: 2 })
  })

  it("still renames the TASK when --tab is absent", async () => {
    const client = new FakeClient({ "task.rename": () => ({ ok: true }) })
    await invokeVerb("rename", ["--task-id", "t1", "--title", "new title"], { client, runtime: stubRuntime() })
    expect(client.requests).toEqual([{ name: "task.rename", payload: { taskId: "t1", title: "new title" } }])
  })

  it("refuses a tab id the snapshot does not name instead of broadcasting into nothing", async () => {
    seedTabs("rename-missing")
    const client = new FakeClient({})
    await expectApiError(
      () =>
        invokeVerb("rename", ["--task-id", "rename-missing", "--tab", "tab-9", "--title", "x"], {
          client,
          runtime: stubRuntime(),
        }),
      "TAB_NOT_FOUND",
    )
    expect(client.requests).toEqual([])
  })
})
