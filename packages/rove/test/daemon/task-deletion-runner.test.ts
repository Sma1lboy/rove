import { describe, expect, it, vi } from "vitest"
import type { DaemonOrchestrator, DaemonTask } from "../../../rove-daemon/src/daemon/contracts.ts"
import { TaskDeletionRunner } from "../../../rove-daemon/src/daemon/task-deletion-runner.ts"
import { hostedTaskKeys } from "../../src/engine/hosted-session.ts"

function task(id: string, phase: "queued" | "running" | "error"): DaemonTask {
  return {
    id,
    title: id,
    repo: "/repo",
    branch: "branch",
    worktreePath: `/wt/${id}`,
    kind: "task",
    status: "backlog",
    deletion: { phase, force: false, requestedAt: "2026-07-15T00:00:00.000Z" },
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
  }
}

describe("TaskDeletionRunner", () => {
  it("deduplicates requests and preserves begin -> session teardown -> cleanup ordering", async () => {
    const order: string[] = []
    let releaseFinish: (() => void) | undefined
    const orch = {
      beginTaskDeletion: vi.fn(async () => {
        order.push("begin")
        return true
      }),
      finishTaskDeletion: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            order.push("finish")
            releaseFinish = resolve
          }),
      ),
      getTask: vi.fn(() => task("t1", "running")),
      listTasks: vi.fn(() => []),
    } as unknown as DaemonOrchestrator
    const tearDownTaskSession = vi.fn(async () => {
      order.push("teardown")
    })
    const clearActivity = vi.fn()
    const runner = new TaskDeletionRunner(orch, { tearDownTaskSession }, clearActivity)

    runner.enqueue("t1")
    runner.enqueue("t1")
    await vi.waitFor(() => expect(releaseFinish).toBeTypeOf("function"))
    expect(order).toEqual(["begin", "teardown", "finish"])
    expect(orch.beginTaskDeletion).toHaveBeenCalledTimes(1)
    expect(orch.finishTaskDeletion).toHaveBeenCalledTimes(1)
    expect(clearActivity).toHaveBeenCalledWith("t1")

    releaseFinish?.()
    await runner.drain()
  })

  it("resumes queued/running records on startup but leaves terminal errors for manual retry", async () => {
    const begun: string[] = []
    const orch = {
      beginTaskDeletion: vi.fn(async (id: string) => {
        begun.push(id)
        return true
      }),
      finishTaskDeletion: vi.fn(async () => {}),
      getTask: vi.fn((id: string) => task(id, "running")),
      listTasks: vi.fn(() => []),
    } as unknown as DaemonOrchestrator
    const runner = new TaskDeletionRunner(orch, { tearDownTaskSession: async () => {} }, () => {})

    runner.resume([task("queued", "queued"), task("running", "running"), task("failed", "error")])
    await runner.drain()

    expect(begun.sort()).toEqual(["queued", "running"])
    expect(orch.finishTaskDeletion).toHaveBeenCalledTimes(2)
  })

  // Logging only a FAILED removal leaves a successful delete — the
  // destructive case that actually closes somebody's tabs — with no trace,
  // and neither line says what was destroyed.
  it("audits both outcomes, naming the task even though the index has dropped it", async () => {
    const lines: string[] = []
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      lines.push(String(chunk))
      return true
    })
    const failing = "boom"
    const orch = {
      beginTaskDeletion: vi.fn(async () => true),
      finishTaskDeletion: vi.fn(async (id: string) => {
        if (id === failing) throw new Error("is not a git worktree")
      }),
      // Mirrors production: after `finishTaskDeletion` the task is GONE from
      // the index, so the audit has to have snapshotted it beforehand.
      getTask: vi.fn((id: string) => task(id, "running")),
      listTasks: vi.fn(() => []),
    } as unknown as DaemonOrchestrator
    const runner = new TaskDeletionRunner(orch, { tearDownTaskSession: async () => {} }, () => {})

    runner.enqueue("ok")
    runner.enqueue(failing)
    await runner.drain()
    spy.mockRestore()

    const log = lines.join("")
    expect(log).toContain("removed task ok")
    expect(log).toContain("/wt/ok")
    expect(log).toContain("failed task boom")
    expect(log).toContain("is not a git worktree")
  })

  // The host here is a key list: the runner hands the runtime a scope, the same `hostedTaskKeys` applies it.
  it("tears a parent down without the PTYs its surviving children live in, and a child takes its own along", async () => {
    const sessions = ["p::tab-1", "p::tab-2", "p::tab-2::leaf-1", "p::tab-3", "other::tab-1"].map((key) => ({ key }))
    const tasks = [
      { ...task("p", "running") },
      { ...task("keeps", "running"), deletion: undefined, ptyAlias: { taskId: "p", tabId: "tab-2" } },
      { ...task("leaves", "running"), ptyAlias: { taskId: "p", tabId: "tab-3" } },
    ]
    const killed: Record<string, string[]> = {}
    const orch = {
      beginTaskDeletion: vi.fn(async () => true),
      finishTaskDeletion: vi.fn(async () => {}),
      getTask: vi.fn((id: string) => tasks.find((t) => t.id === id)),
      listTasks: vi.fn(() => tasks),
    } as unknown as DaemonOrchestrator
    const runner = new TaskDeletionRunner(
      orch,
      {
        tearDownTaskSession: async (id, scope) => {
          killed[id] = hostedTaskKeys(sessions as never, id, scope)
        },
      },
      () => {},
    )

    runner.enqueue("p")
    runner.enqueue("leaves")
    await runner.drain()

    // `keeps` has no `deletion`: its conversation survives; `leaves` is going too.
    expect(killed.p).toEqual(["p::tab-1", "p::tab-3"])
    expect(killed.leaves).toEqual(["p::tab-3"])
  })
})
