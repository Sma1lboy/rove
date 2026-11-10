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
