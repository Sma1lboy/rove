/**
 * `task.resumeQuota`: continuing rate-limited tasks before their quota reset.
 * Real gates/deliveries stores; orchestrator, activity and runtime are fakes.
 */

import { mkdtempSync } from "node:fs"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { DaemonTask, EngineActivityDetail, TaskActivityState } from "../../../rove-daemon/src/daemon/contracts.ts"
import { DeliveriesStore } from "../../../rove-daemon/src/daemon/deliveries-store.ts"
import { GatesStore } from "../../../rove-daemon/src/daemon/gates-store.ts"
import {
  type DaemonHandlerContext,
  createDaemonHandlerRegistry,
  dispatchDaemonRequest,
} from "../../../rove-daemon/src/daemon/handlers.ts"
import { NOW, REPO } from "./automation-runner-fixtures.ts"

const FUTURE = new Date(NOW + 3_600_000).toISOString()

function task(id: string, overrides: Partial<DaemonTask> = {}): DaemonTask {
  return {
    id,
    title: id,
    repo: REPO,
    worktreePath: `${REPO}/${id}`,
    kind: "task",
    status: "in_progress",
    branch: `feat/${id}`,
    vendor: "claude",
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
    ...overrides,
  } satisfies DaemonTask
}

describe("task.resumeQuota", () => {
  const dirs: string[] = []
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
  })

  async function setup(
    tasks: DaemonTask[],
    activity: Record<string, { state: TaskActivityState; detail?: EngineActivityDetail }>,
  ) {
    const dir = mkdtempSync(join(tmpdir(), "rove-quota-now-"))
    dirs.push(dir)
    const deliveries = new DeliveriesStore(join(dir, "deliveries.json"), () => NOW)
    await deliveries.init()
    const gates = new GatesStore(join(dir, "gates.json"), () => new Date(NOW))
    await gates.init()
    const byId = new Map(tasks.map((t) => [t.id, t]))
    const typedInto: string[] = []
    const ctx = {
      orch: {
        listTasks: () => [...byId.values()],
        getTask: (id: string) => byId.get(id),
        setQuotaResume: vi.fn(async (id: string, state: DaemonTask["quotaResume"] | null) => {
          const t = byId.get(id)
          if (t) byId.set(id, { ...t, quotaResume: state ?? undefined })
        }),
      },
      activity: { entryOf: (taskId: string) => activity[taskId] },
      gates,
      deliveries,
      quotaUsage: { peek: () => ({ windows: [{ percent: 100, resetsAt: Date.parse(FUTURE) }] }) },
      runtime: {
        defaultTaskVendor: "claude",
        deliverPromptToLiveEngine: async (target: { id: string }) => {
          typedInto.push(target.id)
          return true
        },
      },
    } as unknown as DaemonHandlerContext
    const registry = createDaemonHandlerRegistry()
    const rpc = (payload: Record<string, unknown> = {}) =>
      dispatchDaemonRequest(registry, "task.resumeQuota", payload, ctx) as Promise<{
        results: { taskId: string; status: string; reason?: string }[]
      }>
    return { rpc, gates, typedInto, task: (id: string) => byId.get(id) }
  }

  const limited = { state: "rate_limited" as const, detail: { failure: "rate_limit" } as EngineActivityDetail }

  it("continues every task waiting on its quota now, and leaves billing stops and idle tasks alone", async () => {
    const h = await setup(
      [
        task("armed", { quotaResume: { resumeAt: FUTURE, requestedAt: new Date(NOW).toISOString() } }),
        task("unknown-reset"),
        task("billing"),
        task("idle"),
      ],
      {
        armed: limited,
        "unknown-reset": limited,
        billing: { state: "rate_limited", detail: { failure: "billing" } as EngineActivityDetail },
        idle: { state: "idle" },
      },
    )
    const { results } = await h.rpc()
    expect(results).toEqual([
      { taskId: "armed", status: "resumed" },
      { taskId: "unknown-reset", status: "resumed" },
    ])
    expect(h.typedInto).toEqual(["armed", "unknown-reset"])
    // The reset timer must not type the continue prompt a second time.
    expect(h.task("armed")?.quotaResume).toBeUndefined()
  })

  it("declines a task awaiting its owner instead of typing into it", async () => {
    const h = await setup([task("gated")], { gated: limited })
    await h.gates.raise({ taskId: "gated", question: "Ship it?" })
    const { results } = await h.rpc({ taskId: "gated" })
    expect(results).toEqual([{ taskId: "gated", status: "declined", reason: "awaiting-owner" }])
    expect(h.typedInto).toEqual([])
  })

  it("returns nothing for a named task that is not rate-limited", async () => {
    const h = await setup([task("busy")], { busy: { state: "running" } })
    expect((await h.rpc({ taskId: "busy" })).results).toEqual([])
    expect(h.typedInto).toEqual([])
  })
})
