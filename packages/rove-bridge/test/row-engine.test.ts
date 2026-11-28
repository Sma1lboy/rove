import { describe, expect, test } from "bun:test"
import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import type { EngineRow } from "../src/rove-ops.ts"
import { engineFor } from "../src/task-rows.ts"

const ENGINES: EngineRow[] = [
  { id: "alpha", name: "Alpha", command: "alpha", protocol: "alpha", builtin: true, enabled: true },
  { id: "alpha-fast", name: "Alpha Fast", command: "alpha --fast", protocol: "alpha", builtin: false, enabled: true },
]

const task = (over: Partial<SerializedTask> & { id: string }): SerializedTask =>
  ({
    title: over.id,
    repo: "/r",
    branch: "b",
    worktreePath: "/w",
    kind: "task",
    status: "in_progress",
    ...over,
  }) as SerializedTask

describe("engine identity", () => {
  test("an exact preset command wins over the protocol's builtin; unknown engines fall back to the vendor id", () => {
    expect(engineFor(task({ id: "a", vendor: "alpha", command: "alpha --fast" } as never), ENGINES)).toEqual({
      id: "alpha-fast",
      name: "Alpha Fast",
    })
    expect(engineFor(task({ id: "b", vendor: "alpha" } as never), ENGINES)).toEqual({ id: "alpha", name: "Alpha" })
    expect(engineFor(task({ id: "c", vendor: "zeta" } as never), ENGINES)).toEqual({ id: null, name: "zeta" })
  })

  test("an engine of another protocol running in the task's tab names the row; the task's own protocol does not", () => {
    const beta: EngineRow = {
      id: "beta",
      name: "Beta",
      command: "beta",
      protocol: "beta",
      builtin: true,
      enabled: true,
    }
    const fast = task({ id: "e", vendor: "alpha", command: "alpha --fast" } as never)
    expect(engineFor(fast, [...ENGINES, beta], "beta")).toEqual({ id: "beta", name: "Beta" })
    expect(engineFor(fast, [...ENGINES, beta], "alpha")).toEqual({ id: "alpha-fast", name: "Alpha Fast" })
  })

  test("a catalog engine launched with extra flags keeps its identity", () => {
    const gamma: EngineRow = {
      id: "gamma",
      name: "Gamma",
      command: "gm",
      protocol: "gamma",
      builtin: false,
      enabled: true,
    }
    expect(
      engineFor(task({ id: "f", vendor: "gamma", command: "gm --model x" } as never), [...ENGINES, gamma]),
    ).toEqual({
      id: "gamma",
      name: "Gamma",
    })
  })

  test("a task on an engine switched off still shows that engine's name", () => {
    const off = ENGINES.map((e) => (e.id === "alpha-fast" ? { ...e, enabled: false } : e))
    expect(engineFor(task({ id: "d", vendor: "alpha", command: "alpha --fast" } as never), off)).toEqual({
      id: "alpha-fast",
      name: "Alpha Fast",
    })
  })
})
