/**
 * A client's machine list comes from the daemon's `machines` push, so a
 * machine registered or removed after the client started still shows up or
 * goes away. With none registered the local task array passes through as is.
 */

import { describe, expect, it } from "vitest"
import type { RemoteOrchestrator } from "../../src/client/remote-orchestrator.ts"
import { createStateCell } from "../../src/lib/external-store.ts"
import { MachineFeed } from "../../src/machines/feed.ts"
import type { Task } from "../../src/types/task.ts"

const task = (id: string, extra: Partial<Task> = {}) => ({ id, title: id, repo: "/r", ...extra }) as Task

function fakeLocal() {
  const tasks = createStateCell<Task[]>([task("local-1")])
  const machines = createStateCell<unknown>(null)
  const orch = { tasksSignal: () => tasks, rawChannelSignal: () => machines } as unknown as RemoteOrchestrator
  return { orch, tasks, machines }
}

const push = (aliases: string[], tasks: Task[]) => ({
  machines: aliases.map((alias) => ({ alias, hostLabel: alias, state: "online" })),
  tasks,
  live: { activity: { "box-1": { state: "working", at: 1 } }, changes: {}, tokens: {} },
})

describe("MachineFeed", () => {
  it("follows machines registered and removed after it started", () => {
    const { orch, tasks, machines } = fakeLocal()
    const feed = new MachineFeed(orch)
    expect(feed.tasksSignal().get()).toBe(tasks.get())

    const remote = task("box-1", { origin: { machineId: "box", hostLabel: "box" } })
    machines.set(push(["box"], [remote]))
    expect(feed.tasksSignal().get().map((t) => [t.id, t.origin?.machineId])).toEqual([
      ["local-1", "local"],
      ["box-1", "box"],
    ])
    expect(feed.machinesSignal().get().map((m) => m.alias)).toEqual(["box"])
    expect(feed.liveSignal().get().activity.get("box-1")?.state).toBe("working")

    machines.set(push([], []))
    expect(feed.tasksSignal().get()).toBe(tasks.get())
    expect(feed.machinesSignal().get()).toEqual([])
  })
})
