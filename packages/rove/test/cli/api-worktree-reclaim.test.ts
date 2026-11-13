/**
 * `worktree-reclaim` — removes the candidates' worktrees, never forced, and
 * reports each one it left alone with a code instead of stopping the batch.
 */

import { createDaemonHandlerRegistry, dispatchDaemonRequest } from "@sma1lboy/rove-daemon/daemon/server"
import type { DaemonHandlerContext } from "@sma1lboy/rove-daemon/daemon/server"
import { describe, expect, it } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import { FakeClient, expectApiError, stubRuntime, taskFixture } from "./api-handler-fixtures.ts"

const MB = 1024 * 1024
const merged = { provider: "github", lifecycle: "merged", checkState: "passing" }
const done = (id: string, extra: Record<string, unknown> = {}) =>
  taskFixture({ id, worktreePath: `/wt/${id}`, prStatus: merged, ...extra })

const CLEAN = done("clean")
const DIRTY = done("dirty")
const BUSY = done("busy")
const MULTI = done("multi", {
  extraRepos: [{ name: "api", repo: "/repo/api", branch: "b", worktreePath: "/wt/multi-api" }],
})
const GONE = done("gone")
const OPEN = taskFixture({ id: "open", worktreePath: "/wt/open", prStatus: { ...merged, lifecycle: "open" } })
const TASKS = [CLEAN, DIRTY, BUSY, MULTI, GONE, OPEN]

function setup() {
  const client = new FakeClient({
    "task.list": () => ({ tasks: TASKS }),
    "debug.inspect": () => ({ activity: { tasks: { busy: { state: "running", at: 0 } }, tabs: {} } }),
    "worktree.remove": (p) => {
      if ((p as { path: string }).path === "/wt/dirty")
        throw new Error("DIRTY_WORKTREE: /wt/dirty has uncommitted files")
      return { removed: true }
    },
  })
  const runtime = stubRuntime({
    measureCheckout: async (path) =>
      path === "/wt/gone"
        ? { exists: false, bytes: null, ignoredBytes: null }
        : { exists: true, bytes: (path === "/wt/clean" ? 5 : 1) * MB, ignoredBytes: 0 },
  })
  return { client, deps: { client, runtime } }
}

const removedPaths = (client: FakeClient) =>
  client.requests.filter((r) => r.name === "worktree.remove").map((r) => r.payload)

describe("worktree-reclaim", () => {
  it("removes clean candidates unforced and reports the rest as skipped with a code", async () => {
    const { client, deps } = setup()
    const out = (await invokeVerb("worktree-reclaim", ["--merged"], deps)) as {
      dryRun: boolean
      removed: { taskId: string }[]
      skipped: { taskId: string; code: string }[]
      bytes: number
    }
    expect(out.dryRun).toBe(false)
    expect(out.removed.map((r) => r.taskId)).toEqual(["clean"])
    expect(Object.fromEntries(out.skipped.map((s) => [s.taskId, s.code]))).toEqual({
      dirty: "DIRTY_WORKTREE",
      busy: "TASK_BUSY",
      multi: "MULTI_REPO",
    })
    expect(out.bytes).toBe(5 * MB)
    expect(removedPaths(client)).toEqual([
      { path: "/wt/clean", force: false },
      { path: "/wt/dirty", force: false },
    ])
  })

  it("--dry-run removes nothing and lists what would go", async () => {
    const { client, deps } = setup()
    const out = await invokeVerb("worktree-reclaim", ["--merged", "--dry-run"], deps)
    expect(out).toMatchObject({ dryRun: true, removed: [{ taskId: "clean" }, { taskId: "dirty" }] })
    expect(removedPaths(client)).toEqual([])
  })

  it.each(["running", "permission_needed"])("preserves a task becoming %s during measurement", async (busyState) => {
    let state = "idle"
    let sessionAlive = true
    let checkoutExists = true
    const ctx = {
      orch: { listTasks: () => [CLEAN], clearWorktreePath: async () => {} },
      activity: { stateOf: () => state },
      runtime: {
        tearDownTaskSession: async () => {
          sessionAlive = false
        },
        removeWorktree: async () => {
          checkoutExists = false
        },
      },
    } as unknown as DaemonHandlerContext
    const registry = createDaemonHandlerRegistry()
    const client = new FakeClient({
      "task.list": () => ({ tasks: [CLEAN] }),
      "debug.inspect": () => ({ activity: { tasks: { clean: { state, at: 0 } }, tabs: {} } }),
      "worktree.remove": (payload) => dispatchDaemonRequest(registry, "worktree.remove", payload, ctx),
    })
    const runtime = stubRuntime({
      measureCheckout: async () => {
        state = busyState
        return { exists: true, bytes: MB, ignoredBytes: 0 }
      },
    })
    const out = await invokeVerb("worktree-reclaim", ["--merged"], { client, runtime })
    expect(out).toMatchObject({ removed: [], skipped: [{ taskId: "clean", code: "TASK_BUSY" }], bytes: 0 })
    expect({ sessionAlive, checkoutExists }).toEqual({ sessionAlive: true, checkoutExists: true })
  })

  it("skips a shared owner in dry-run even when its child is not a candidate", async () => {
    const client = new FakeClient({
      "task.list": () => ({
        tasks: [CLEAN, taskFixture({ id: "child", sharesWorkspaceOf: "clean", worktreePath: "/wt/clean" })],
      }),
      "debug.inspect": () => ({ activity: { tasks: {}, tabs: {} } }),
    })
    const runtime = stubRuntime({ measureCheckout: async () => ({ exists: true, bytes: MB, ignoredBytes: 0 }) })
    const out = await invokeVerb("worktree-reclaim", ["--merged", "--dry-run"], { client, runtime })
    expect(out).toMatchObject({ removed: [], skipped: [{ taskId: "clean", code: "WORKTREE_SHARED" }], bytes: 0 })
    expect(removedPaths(client)).toEqual([])
  })

  it("refuses to run without a cleanup filter", async () => {
    const { client, deps } = setup()
    await expectApiError(() => invokeVerb("worktree-reclaim", ["--dry-run"], deps), "BAD_FLAG")
    expect(client.requests).toEqual([])
  })
})
