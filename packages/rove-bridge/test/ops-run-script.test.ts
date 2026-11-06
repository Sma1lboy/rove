import { describe, expect, test } from "bun:test"
import type { StateSnapshot } from "@sma1lboy/rove/src/state/store.ts"
import { RUN_TASKS_KEY, type RunDeps, pickPort, portRange, runOps } from "../src/ops/run-script.ts"
import { T, fakeApi } from "./task-ops-harness.ts"

const RANGE = { base: 4100, count: 3 }

function harness(opts: { script?: boolean; state?: StateSnapshot; busy?: readonly number[]; alive?: boolean } = {}) {
  let state: StateSnapshot = opts.state ?? {}
  const busy = new Set(opts.busy ?? [])
  const deps: RunDeps = {
    load: () => state,
    update: (compute) => {
      state = { ...state, ...compute(state) }
    },
    portFree: async (port) => !busy.has(port),
    hasScript: () => opts.script ?? true,
  }
  const replies = {
    "get-task": { task: { worktreePath: "/wt" } },
    "tab-new": { tabId: "tab-1", session: "C1::tab-1", childTaskId: "C1" },
    ports: { ports: [{ port: 4100 }] },
    update: {},
    "tab-close": {},
    "pty-list": { sessions: [{ key: "C1::tab-1", alive: opts.alive ?? true }] },
  }
  const { api, calls } = fakeApi(replies)
  const ops = runOps(deps)
  return {
    calls,
    state: () => state,
    call: (op: string, args: Record<string, unknown> = { taskId: T }) =>
      ops[op]?.run(args, { api }) as Promise<Record<string, unknown>>,
  }
}

describe("run ports", () => {
  test("a task takes the lowest free port no other task holds, and keeps its own while it is free", async () => {
    const free = async () => true
    expect(await pickPort(RANGE, new Set([4100]), undefined, false, free)).toBe(4101)
    expect(await pickPort(RANGE, new Set([4100]), 4102, false, free)).toBe(4102)
  })

  test("a port something else now holds is replaced, unless the task's own run holds it", async () => {
    const heldBy =
      (...ports: number[]) =>
      async (port: number) =>
        !ports.includes(port)
    expect(await pickPort(RANGE, new Set(), 4100, false, heldBy(4100))).toBe(4101)
    expect(await pickPort(RANGE, new Set(), 4100, true, heldBy(4100))).toBe(4100)
  })

  test("a full range is refused rather than reused", async () => {
    await expect(
      pickPort(RANGE, new Set([4100, 4101]), undefined, false, async (p) => p !== 4102),
    ).rejects.toMatchObject({
      code: "NO_PORT",
    })
  })

  test("a hand-edited range that is not usable falls back to the default", () => {
    expect(portRange({})).toEqual({ base: 4100, count: 900 })
    expect(portRange({ "run.portBase": 9000, "run.portCount": 10 })).toEqual({ base: 9000, count: 10 })
    expect(portRange({ "run.portBase": 80, "run.portCount": "x" })).toEqual({ base: 4100, count: 900 })
  })
})

describe("run.start / run.stop", () => {
  test("start types the repo's script with the port into a new shell tab and remembers both", async () => {
    const h = harness({ state: { [RUN_TASKS_KEY]: { OTHER: { port: 4100 } } } })
    const res = await h.call("run.start")
    expect(res).toMatchObject({ running: true, port: 4101 })
    expect(h.calls.find((c) => "verb" in c && c.verb === "tab-new")).toMatchObject({
      argv: [`--task-id=${T}`, "--kind=shell", "--type=env PORT=4101 ROVE_PORT=4101 sh .rove/run.sh"],
    })
    expect(h.state()[RUN_TASKS_KEY]).toMatchObject({
      OTHER: { port: 4100 },
      [T]: { port: 4101, session: "C1::tab-1", taskId: "C1", tabId: "tab-1" },
    })
  })

  test("a repo without the script is refused and opens nothing", async () => {
    const h = harness({ script: false })
    await expect(h.call("run.start")).rejects.toMatchObject({ code: "NO_RUN_SCRIPT" })
    expect(h.calls.some((c) => "verb" in c && c.verb === "tab-new")).toBe(false)
  })

  test("starting a run that is already alive opens no second tab", async () => {
    const h = harness({
      state: { [RUN_TASKS_KEY]: { [T]: { port: 4100, session: "C1::tab-1", taskId: "C1", tabId: "tab-1" } } },
    })
    expect(await h.call("run.start")).toMatchObject({ running: true, port: 4100 })
    expect(h.calls.some((c) => "verb" in c && c.verb === "tab-new")).toBe(false)
  })

  test("stop interrupts and closes the run tab but keeps the task's port", async () => {
    const h = harness({
      state: { [RUN_TASKS_KEY]: { [T]: { port: 4100, session: "C1::tab-1", taskId: "C1", tabId: "tab-1" } } },
    })
    await h.call("run.stop")
    expect(h.calls.find((c) => "verb" in c && c.verb === "tab-close")).toMatchObject({
      argv: ["--task-id=C1", "--tab=tab-1"],
    })
    expect(h.state()[RUN_TASKS_KEY]).toEqual({ [T]: { port: 4100 } })
  })
})

describe("run.status", () => {
  const record = { [T]: { port: 4100, session: "C1::tab-1", taskId: "C1", tabId: "tab-1" } }

  test("a listening port gives the url; a tab that died is not running", async () => {
    const up = await harness({ state: { [RUN_TASKS_KEY]: record } }).call("run.status")
    expect(up).toEqual({ script: true, running: true, port: 4100, listening: true, url: "http://localhost:4100" })
    const dead = await harness({ state: { [RUN_TASKS_KEY]: record }, alive: false }).call("run.status")
    expect(dead).toMatchObject({ running: false, listening: false, url: null })
  })

  test("no script means nothing to show", async () => {
    expect(await harness({ script: false }).call("run.status")).toMatchObject({ script: false, running: false })
  })
})
