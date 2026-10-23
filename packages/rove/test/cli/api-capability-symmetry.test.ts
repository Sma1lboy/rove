/**
 * The five CLI halves that were missing while the TUI (or the create/read
 * side) already had them. Each test fails with its verb removed and with
 * nothing else, because each pins the ONE request the missing half has to
 * send — not the plumbing around it.
 *
 * - `issue-delete` — the kanban page's `d` runs the store's `delete` op; the
 *   CLI could only mark a story `done` and leave it.
 * - `note-delete` — the reader dialog can retire a note; the CLI could only
 *   append and list, so a note whose fact stopped being true kept riding into
 *   every new session on the repo.
 * - `delete --group` — create (`add --count`) and read (`collect --group`)
 *   are batched; closing the round was one call per loser.
 * - `remove-worktree` — `ensure-worktree` materializes without an engine and
 *   had no inverse, so reclaiming a checkout meant `delete`, which takes the
 *   task record too.
 * - `update --tab` — a tab could be opened, closed, read and written from the
 *   CLI, but not named.
 */

import { describe, expect, it } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { publishCliTabSnapshot } from "../../src/cli/api/tab-snapshot.ts"
import { FakeClient, expectApiError, recordingTearDown, stubRuntime, taskFixture } from "./api-handler-fixtures.ts"
import { mintEngineTab, tabsDaemon } from "./tabs-daemon-fake.ts"

describe("issue-delete", () => {
  it("sends the store's delete op, the same one the kanban page's `d` runs", async () => {
    const client = new FakeClient({ "issue.mutate": () => ({ issues: [], nextId: 4 }) })
    await invokeVerb("issue-delete", ["--repo", "/repo/x", "--id", "3"], { client, runtime: stubRuntime() })
    expect(client.requests).toEqual([
      { name: "issue.mutate", payload: { repoRoot: "/repo/x", op: { type: "delete", id: 3 } } },
    ])
  })
})

describe("note-delete", () => {
  it("addresses the note by ID, not by its position in the list", async () => {
    // Notes are prepended and evicted from the tail, so an index names a
    // different fact tomorrow. This is the assertion that a switch to
    // positional addressing has to break.
    const client = new FakeClient({ "note.delete": () => ({ deleted: false }) })
    const res = (await invokeVerb("note-delete", ["--repo", "/repo/x", "--id", "1"], {
      client,
      runtime: stubRuntime(),
    })) as { deleted: boolean }
    // An id nothing holds answers false rather than throwing — an evicted
    // note and a mistyped id are the same answer, and neither is an error.
    expect(res.deleted).toBe(false)
    expect(client.requests).toEqual([{ name: "note.delete", payload: { repo: "/repo/x", id: 1 } }])
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

describe("update --tab", () => {
  /** A daemon holding a real two-tab record — seeded by the same writers the CLI's own launch path uses. */
  async function seedTabs(taskId: string, broadcast: Record<string, () => unknown> = {}) {
    const daemon = tabsDaemon({ extra: broadcast })
    await publishCliTabSnapshot(daemon.client, taskId)
    const tabId = await mintEngineTab(daemon.client, taskId)
    daemon.requests.length = 0
    return { daemon, tabId }
  }

  it("renames through the daemon's tab store, then broadcasts for older listeners", async () => {
    // The daemon's apply is the whole rename (it publishes `tabs.changed` to
    // every attached TUI); `terminalTab.rename` is kept for older listeners.
    const { daemon, tabId } = await seedTabs("rename-both", {
      "terminalTab.rename": () => ({ ok: true, clients: 2 }),
    })
    const res = await invokeVerb("update", ["--task-id", "rename-both", "--tab", tabId, "--title", "e2e"], {
      client: daemon.client,
      runtime: stubRuntime(),
    })
    expect(daemon.tabs("rename-both")?.tabs.find((t) => t.id === tabId)?.title).toBe("e2e")
    expect(daemon.requests).toEqual(["tabs.get", "tabs.apply", "terminalTab.rename"])
    expect(daemon.applied.at(-1)).toEqual({
      taskId: "rename-both",
      ops: [{ op: "patch", id: tabId, set: { title: "e2e" } }],
    })
    expect(res).toMatchObject({ taskId: "rename-both", tabId, title: "e2e", renamed: true, clients: 2 })
  })

  it("refuses a tab id the daemon does not hold instead of broadcasting into nothing", async () => {
    const { daemon } = await seedTabs("rename-missing")
    await expectApiError(
      () =>
        invokeVerb("update", ["--task-id", "rename-missing", "--tab", "tab-9", "--title", "x"], {
          client: daemon.client,
          runtime: stubRuntime(),
        }),
      "TAB_NOT_FOUND",
    )
    expect(daemon.requests).toEqual(["tabs.get"])
  })
})
