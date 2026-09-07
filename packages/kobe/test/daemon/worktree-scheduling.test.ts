import type { DaemonTask, WorktreeChanges } from "@sma1lboy/kobe-daemon/daemon/contracts"
import { DaemonEventBus } from "@sma1lboy/kobe-daemon/daemon/event-bus"
import type { WorktreeChangesPayload } from "@sma1lboy/kobe-daemon/daemon/protocol"
import { WorktreeChangesCollector } from "@sma1lboy/kobe-daemon/daemon/worktree-changes-collector"
import { afterEach, expect, it, vi } from "vitest"

const tasks = (count: number): DaemonTask[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `t${i}`,
    title: `t${i}`,
    repo: "/repo",
    branch: `t${i}`,
    worktreePath: `/wt/${i}`,
    status: "backlog",
    createdAt: "",
    updatedAt: "",
  }))
const collectors: WorktreeChangesCollector[] = []
afterEach(() => {
  for (const c of collectors.splice(0)) c.stop()
  vi.useRealTimers()
})

function fixture(count = 200) {
  let current = tasks(count)
  let subscribed = true
  const pending = new Map<string, { resolve: (v: WorktreeChanges) => void; signal: AbortSignal }>()
  const runs: string[] = []
  const published: WorktreeChangesPayload[] = []
  const bus = new DaemonEventBus()
  bus.onPublish((e) => {
    if (e.channel === "worktree.changes") published.push(e.payload as WorktreeChangesPayload)
  })
  const c = new WorktreeChangesCollector({ listTasks: () => current }, bus, {
    probe: () => null,
    hasSubscribers: () => subscribed,
    activeTaskIds: () => ["t0", "t1", "t2", "t3"],
    cadence: { timeoutMs: 100, slowRetryMs: 1000, minIntervalMs: 0 },
    run: (path, signal) => {
      runs.push(path)
      return new Promise((resolve) => pending.set(path, { resolve, signal }))
    },
  })
  collectors.push(c)
  const finish = () => {
    const batch = [...pending.values()]
    pending.clear()
    for (const p of batch) p.resolve({ added: 1, deleted: 0 })
  }
  return {
    c,
    runs,
    pending,
    published,
    finish,
    setTasks: (next: DaemonTask[]) => {
      current = next
    },
    setSubscribed: (next: boolean) => {
      subscribed = next
    },
  }
}

it("caps 200 due runs at four and serves the tail before continuously active front entries", async () => {
  vi.useFakeTimers()
  const h = fixture()
  h.c.tick()
  let peak = 0
  for (let wave = 0; wave < 50; wave++) {
    peak = Math.max(peak, h.pending.size)
    h.c.tick()
    h.finish()
    await vi.advanceTimersByTimeAsync(1)
    h.c.tick()
  }
  expect(peak).toBe(4)
  expect(h.runs.slice(0, 200)).toEqual(tasks(200).map((t) => t.worktreePath))
  await vi.advanceTimersByTimeAsync(10)
  expect(Object.keys(h.published.at(-1)?.changes ?? {})).toHaveLength(200)
  expect(h.published.length).toBeLessThan(20)
})

it("prunes queued and in-flight results, including deleting and re-adding the same path", async () => {
  vi.useFakeTimers()
  const h = fixture(10)
  h.c.tick()
  h.setTasks([])
  h.c.tick()
  h.setTasks(tasks(1))
  h.c.tick()
  expect(h.runs).toHaveLength(4)
  h.finish()
  await vi.advanceTimersByTimeAsync(1)
  expect(h.runs).toEqual(["/wt/0", "/wt/1", "/wt/2", "/wt/3", "/wt/0"])
  await vi.advanceTimersByTimeAsync(10)
  expect(h.published).toEqual([])
  h.finish()
  await vi.advanceTimersByTimeAsync(11)
  expect(h.published.at(-1)).toEqual({ changes: { "/wt/0": { added: 1, deleted: 0 } } })
})

it("stop cancels queued work, aborts running work and suppresses delayed and late publications", async () => {
  vi.useFakeTimers()
  const h = fixture()
  h.c.tick()
  const running = [...h.pending.values()]
  h.c.stop()
  expect(running.every((p) => p.signal.aborted)).toBe(true)
  h.finish()
  await vi.advanceTimersByTimeAsync(1000)
  h.c.tick()
  expect(h.runs).toHaveLength(4)
  expect(h.published).toEqual([])
})

it("subscriber loss pauses the queue until the next subscribed tick", async () => {
  vi.useFakeTimers()
  const h = fixture(8)
  h.c.tick()
  h.setSubscribed(false)
  h.finish()
  await vi.advanceTimersByTimeAsync(20)
  expect(h.runs).toHaveLength(4)
  h.setSubscribed(true)
  h.c.tick()
  expect(h.runs.slice(4)).toEqual(["/wt/4", "/wt/5", "/wt/6", "/wt/7"])
})

it("timed-out runs keep their slots until settlement and retain hard backoff", async () => {
  vi.useFakeTimers()
  const h = fixture(8)
  h.c.tick()
  await vi.advanceTimersByTimeAsync(101)
  expect([...h.pending.values()].every((p) => p.signal.aborted)).toBe(true)
  expect(h.runs).toHaveLength(4)
  h.finish()
  await vi.advanceTimersByTimeAsync(1)
  h.c.tick()
  expect(h.runs.slice(4)).toEqual(["/wt/4", "/wt/5", "/wt/6", "/wt/7"])
  h.finish()
  await vi.advanceTimersByTimeAsync(20)
  h.c.tick()
  expect(h.runs.filter((p) => p === "/wt/0")).toHaveLength(1)
  expect(h.published.at(-1)?.changes["/wt/0"]).toBeUndefined()
})

it("stop also cancels a publication that was already scheduled", async () => {
  vi.useFakeTimers()
  const h = fixture(1)
  h.c.tick()
  h.finish()
  await vi.advanceTimersByTimeAsync(1)
  expect(h.published).toEqual([])
  h.c.stop()
  await vi.advanceTimersByTimeAsync(100)
  expect(h.published).toEqual([])
})
