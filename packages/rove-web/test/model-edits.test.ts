import { afterEach, expect, mock, spyOn, test } from "bun:test"

// `ui.ts` reads localStorage at import.
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  writable: true,
  value: { getItem: () => null, setItem() {} },
})
const { BridgeClient } = await import("../src/bridge.ts")
const { AppModel } = await import("../src/model.ts")

const hadWindow = Object.getOwnPropertyDescriptor(globalThis, "window")
afterEach(() => {
  mock.restore()
  if (hadWindow) Object.defineProperty(globalThis, "window", hadWindow)
  else Reflect.deleteProperty(globalThis, "window")
})
const flush = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** A model on a client whose requests the test answers and whose pushes it sends. */
function modelHarness() {
  const timers: Array<() => void> = []
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: {
      setTimeout(fn: () => void) {
        timers.push(fn)
        return timers.length
      },
    },
  })
  const client = new BridgeClient("ws://test", "test")
  client.conn.set({ state: "open", hello: null, failures: 0 })
  const calls: Array<{
    op: string
    args: Record<string, unknown>
    resolve: (value: unknown) => void
    reject: (error: Error) => void
  }> = []
  spyOn(client, "request").mockImplementation(
    <T>(op: string, args: Record<string, unknown> = {}) =>
      new Promise<T>((resolve, reject) => calls.push({ op, args, resolve: (value) => resolve(value as T), reject })),
  )
  const handlers = new Map<string, (data: unknown) => void>()
  spyOn(client, "on").mockImplementation((event, callback) => {
    handlers.set(event, callback)
    return () => {}
  })
  const push = (event: string, data: unknown) => handlers.get(event)?.(data)
  return { model: new AppModel(client), calls, timers, push }
}

test("an archived row leaves when clicked, stays gone through a push read before the daemon applied it, and returns if refused", async () => {
  const { archiveEdit } = await import("../src/optimistic.ts")
  const { model, calls, push } = modelHarness()
  const served = { tasks: [{ id: "A" }, { id: "B", parentTaskId: "A" }, { id: "C" }], attention: [] }
  calls[0].resolve(served)
  await flush()
  const ids = () => model.tasks.get()?.tasks.map((task) => task.id)

  let settle: { resolve: () => void; reject: (err: Error) => void } = { resolve() {}, reject() {} }
  const request = () =>
    new Promise<void>((resolve, reject) => {
      settle = { resolve, reject }
    })
  const done = model.optimistic(archiveEdit("A", true), request)
  expect(ids()).toEqual(["C"])
  expect(model.tasks.get()?.archived?.map((task) => task.id)).toEqual(["A", "B"])
  push("tasks", served)
  expect(ids()).toEqual(["C"])
  settle.resolve()
  await done
  expect(ids()).toEqual(["C"])
  // The daemon's own list takes over from the next push on.
  push("tasks", { tasks: [{ id: "C" }, { id: "D" }], attention: [] })
  expect(ids()).toEqual(["C", "D"])

  const refused = model.optimistic(archiveEdit("C", true), request)
  expect(ids()).toEqual(["D"])
  settle.reject(new Error("TASK_BUSY"))
  await expect(refused).rejects.toThrow("TASK_BUSY")
  expect(ids()).toEqual(["C", "D"])
})

test("a done archive stays hidden through pushes that still list the row, as another machine's list arrives late", async () => {
  const { archiveEdit } = await import("../src/optimistic.ts")
  const { model, calls, push } = modelHarness()
  const stale = { tasks: [{ id: "far", machine: { id: "win", label: "win" } }, { id: "C" }], attention: [] }
  calls[0].resolve(stale)
  await flush()
  const shown = () => [...(model.tasks.get()?.tasks ?? []), ...model.remote.get()].map((task) => task.id)

  await model.optimistic(archiveEdit("far", true), async () => {})
  push("tasks", stale)
  push("tasks", stale)
  expect(shown()).toEqual(["C"])
  push("tasks", { tasks: [{ id: "C" }], attention: [] })
  // Back on the daemon's own list: a row listed again later is drawn.
  push("tasks", stale)
  expect(shown()).toEqual(["C", "far"])
})

test("archiving a row alone leaves its children listed, one level up", async () => {
  const { archiveEdit } = await import("../src/optimistic.ts")
  const edited = archiveEdit(
    "A",
    true,
    true,
  )({ tasks: [{ id: "A" }, { id: "B", parentTaskId: "A" }], attention: [] } as never)
  expect(edited.tasks.map((task) => [task.id, task.parentTaskId])).toEqual([["B", undefined]])
  expect(edited.archived?.map((task) => task.id)).toEqual(["A"])
})

test("a closed tab leaves the strip on the click, and comes back if the close was refused", async () => {
  const { model, calls, timers } = modelHarness()
  calls[0].resolve({ tasks: [{ id: "A" }], attention: [] })
  await flush()
  timers.shift()?.()
  calls.find((call) => call.op === "task.tabs")?.resolve({ tabs: [{ id: "t1" }, { id: "t2" }] })
  await flush()
  const ids = () => model.tabs.get().A?.map((tab) => tab.id)
  expect(ids()).toEqual(["t1", "t2"])

  const closing = model.closeTab("A", "t2")
  expect(ids()).toEqual(["t1"])
  calls.find((call) => call.op === "tab.close")?.reject(new Error("refused"))
  await flush()
  calls
    .filter((call) => call.op === "task.tabs")
    .at(-1)
    ?.resolve({ tabs: [{ id: "t1" }, { id: "t2" }] })
  await expect(closing).rejects.toThrow("refused")
  expect(ids()).toEqual(["t1", "t2"])
})

test("a patch changes the rows it names; one that starts from another revision asks for the list again", async () => {
  const { model, calls, push } = modelHarness()
  expect(calls[0].args).toEqual({ patches: true })
  calls[0].resolve({
    rev: 4,
    tasks: [
      { id: "A", title: "a" },
      { id: "B", title: "b" },
    ],
    attention: [],
  })
  await flush()

  push("tasks.patch", { from: 4, rev: 5, tasks: { upsert: [{ id: "B", title: "renamed" }], remove: [] } })
  expect(model.tasks.get()?.tasks).toEqual([
    { id: "A", title: "a" },
    { id: "B", title: "renamed" },
  ] as never)

  // Revision 6 never arrived.
  push("tasks.patch", { from: 6, rev: 7, tasks: { upsert: [], remove: ["A"] } })
  expect(model.tasks.get()?.tasks.map((task) => task.id)).toEqual(["A", "B"])
  const again = calls.filter((call) => call.op === "tasks.subscribe")
  expect(again).toHaveLength(2)
  again[1].resolve({ rev: 7, tasks: [{ id: "B", title: "renamed" }], attention: [] })
  await flush()
  expect(model.tasks.get()?.tasks.map((task) => task.id)).toEqual(["B"])
})

test("archiving or deleting a project's first row keeps the project in place before the daemon answers", async () => {
  const { archiveEdit, taskEdit } = await import("../src/optimistic.ts")
  const { groupByProject } = await import("../src/rail.ts")
  const row = (id: string, repo: string, order: number) => ({ id, repo, kind: "dir", rank: order, order }) as never
  const payload = {
    tasks: [row("a1", "/a", 0), row("b", "/b", 1), row("a2", "/a", 2), row("a3", "/a", 3)],
    attention: [],
  }
  const projects = (edited: { tasks: readonly never[] }) => groupByProject(edited.tasks).map((group) => group.repo)
  const archived = archiveEdit("a1", true)(payload as never)
  expect(projects(archived as never)).toEqual(["/a", "/b"])
  expect(groupByProject(archived.tasks)[0]?.tasks.map((task) => task.id)).toEqual(["a2", "a3"])
  expect(projects(taskEdit("task.delete", { taskId: "a1" })?.(payload as never) as never)).toEqual(["/a", "/b"])
})
