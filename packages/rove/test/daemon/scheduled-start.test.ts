import { describe, expect, it, vi } from "vitest"
import type { DaemonTask } from "../../../rove-daemon/src/daemon/contracts.ts"
import {
  type ScheduledStartDeps,
  dueScheduledStarts,
  startScheduledNow,
} from "../../../rove-daemon/src/daemon/scheduled-start.ts"

const NOW = Date.parse("2026-11-06T22:00:00.000Z")
const PAST = new Date(NOW - 1000).toISOString()
const FUTURE = new Date(NOW + 60_000).toISOString()

function task(id: string, overrides: Partial<DaemonTask> = {}): DaemonTask {
  return {
    id,
    title: id,
    repo: "/repo",
    branch: "b",
    worktreePath: `/wt/${id}`,
    kind: "task",
    status: "backlog",
    createdAt: PAST,
    updatedAt: PAST,
    ...overrides,
  }
}

const armed = (at: string) => ({ scheduledStart: { at, prompt: "do the thing" } })

function deps(tasks: DaemonTask[], started = true) {
  const calls: string[] = []
  const d: ScheduledStartDeps = {
    orch: {
      listTasks: () => tasks,
      getTask: (id) => tasks.find((t) => t.id === id),
      setScheduledStart: async (id) => void calls.push(`clear:${id}`),
      setPrompt: async (id, p) => void calls.push(`prompt:${id}:${p}`),
      ensureMainTask: async () => {
        throw new Error("no pending start in this test")
      },
      openDirectoryTask: async () => {
        throw new Error("no pending start in this test")
      },
    },
    runtime: {
      startTaskSessionWithPrompt: vi.fn(async (_link, id, p) => {
        calls.push(`start:${id}:${p}`)
        return { started }
      }),
    },
    link: {} as never,
  }
  return { d, calls }
}

describe("dueScheduledStarts", () => {
  it("selects armed tasks whose time has come, past due or at the instant, and ignores later and unarmed ones", () => {
    const due = dueScheduledStarts(
      [
        task("past", armed(PAST)),
        task("now", armed(new Date(NOW).toISOString())),
        task("later", armed(FUTURE)),
        task("unarmed"),
        task("deleting", { ...armed(PAST), deletion: { phase: "queued" } as never }),
      ],
      NOW,
    )
    expect(due.map((t) => t.id)).toEqual(["past", "now"])
  })
})

describe("startScheduledNow", () => {
  it("clears the schedule before it starts the engine with the scheduled message", async () => {
    const { d, calls } = deps([task("a", armed(PAST))])
    expect(await startScheduledNow(d, "a")).toBe("started")
    expect(calls).toEqual(["clear:a", "prompt:a:do the thing", "start:a:do the thing"])
  })

  it("drops the schedule of a task someone already started by hand, without starting a second engine", async () => {
    const { d, calls } = deps([task("a", { ...armed(PAST), prompt: "typed by hand" })])
    expect(await startScheduledNow(d, "a")).toBe("dropped")
    expect(calls).toEqual(["clear:a"])
  })

  it("does not re-arm after a failed start", async () => {
    const { d, calls } = deps([task("a", armed(PAST))], false)
    expect(await startScheduledNow(d, "a")).toBe("failed")
    expect(calls.filter((c) => c.startsWith("clear"))).toEqual(["clear:a"])
  })

  it("is a no-op for a task with nothing scheduled", async () => {
    const { d, calls } = deps([task("a")])
    expect(await startScheduledNow(d, "a")).toBe("dropped")
    expect(calls).toEqual([])
  })
})
