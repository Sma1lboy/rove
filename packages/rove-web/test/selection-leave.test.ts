import { afterEach, expect, mock, spyOn, test } from "bun:test"

// `ui.ts` reads localStorage at import.
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  writable: true,
  value: { getItem: () => null, setItem() {} },
})
const { BridgeClient } = await import("../src/bridge.ts")
const { AppModel } = await import("../src/model.ts")
const { newSession } = await import("../src/ui.ts")

afterEach(() => {
  mock.restore()
  newSession.set(null)
})

/** A model on a client that answers the first list with `tasks` and takes pushes from the test. */
async function opened(tasks: readonly Record<string, unknown>[], archived: readonly Record<string, unknown>[] = []) {
  Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: { setTimeout: () => 0 } })
  const client = new BridgeClient("ws://test", "test")
  client.conn.set({ state: "open", hello: null, failures: 0 })
  const answers: Array<(value: unknown) => void> = []
  spyOn(client, "request").mockImplementation(
    <T>() => new Promise<T>((resolve) => answers.push((value) => resolve(value as T))),
  )
  const handlers = new Map<string, (data: unknown) => void>()
  spyOn(client, "on").mockImplementation((event, callback) => {
    handlers.set(event, callback)
    return () => {}
  })
  const model = new AppModel(client)
  answers[0]?.({ tasks, archived, attention: [] })
  await new Promise((resolve) => setTimeout(resolve, 0))
  const push = (next: readonly Record<string, unknown>[], nextArchived = archived) =>
    handlers.get("tasks")?.({ tasks: next, archived: nextArchived, attention: [] })
  return { model, push }
}

test("archiving, deleting or losing the open task opens New task on No folder", async () => {
  for (const after of [
    [{ id: "b" }], // archived here, or deleted from another client or the CLI
    [{ id: "a", deleting: true }, { id: "b" }], // a delete in flight
  ]) {
    const { model, push } = await opened([{ id: "a" }, { id: "b" }])
    model.select("b")
    model.select("a")
    push(after)
    expect(model.selection.get()).toEqual({ taskId: null, tabId: null })
    expect(newSession.get()).toMatchObject({ ungrouped: true })
    newSession.set(null)
  }
})

test("another machine's open task leaving opens New task too", async () => {
  const { model, push } = await opened([{ id: "a" }, { id: "r", machine: { alias: "deck" } }])
  model.select("r")
  push([{ id: "a" }])
  expect(model.selection.get().taskId).toBeNull()
  expect(newSession.get()).toMatchObject({ ungrouped: true })
})

test("archiving a task that is not open changes nothing shown", async () => {
  const { model, push } = await opened([{ id: "a" }, { id: "b" }])
  model.select("a")
  push([{ id: "a" }])
  expect(model.selection.get().taskId).toBe("a")
  expect(newSession.get()).toBeNull()
})

test("an archived task opened from the fold stays open", async () => {
  const { model, push } = await opened([{ id: "b" }], [{ id: "a" }])
  model.select("a")
  push([{ id: "b" }])
  expect(model.selection.get().taskId).toBe("a")
  expect(newSession.get()).toBeNull()
})

test("a composer already up stays as it was", async () => {
  const { model, push } = await opened([{ id: "a" }, { id: "b" }])
  model.select("a")
  const shown = { repo: "/src/app" }
  newSession.set(shown)
  push([{ id: "b" }])
  expect(newSession.get()).toBe(shown)
})
