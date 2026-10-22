import { afterEach, expect, mock, spyOn, test } from "bun:test"
import { BridgeClient } from "../src/bridge.ts"
import { AppModel } from "../src/model.ts"
import { createStore } from "../src/store.ts"

class Renderer {
  cols = 80
  rows = 24
  unicode = { activeVersion: "" }
  loadAddon() {}
  open() {}
  focus() {}
  dispose() {}
  reset() {}
  write() {}
  textarea = null
  attachCustomKeyEventHandler() {}
  onScroll() {
    return { dispose() {} }
  }
  onWriteParsed() {
    return { dispose() {} }
  }
  onKey() {
    return { dispose() {} }
  }
  parser = {
    registerCsiHandler: () => ({ dispose() {} }),
    registerEscHandler: () => ({ dispose() {} }),
  }
  options = {}
  onData() {
    return { dispose() {} }
  }
  onResize() {
    return { dispose() {} }
  }
}
class Addon {
  fit() {}
  onContextLoss() {}
  dispose() {}
}
mock.module("@xterm/xterm", () => ({ Terminal: Renderer }))
class SearchAddon {
  findNext() {}
  findPrevious() {}
  clearDecorations() {}
  onDidChangeResults() {
    return { dispose() {} }
  }
}
mock.module("@xterm/addon-search", () => ({ SearchAddon }))
mock.module("@xterm/addon-fit", () => ({ FitAddon: Addon }))
mock.module("@xterm/addon-unicode11", () => ({ Unicode11Addon: Addon }))
mock.module("@xterm/addon-web-links", () => ({ WebLinksAddon: Addon }))
mock.module("@xterm/addon-webgl", () => ({ WebglAddon: Addon }))
mock.module("../src/i18n/index.ts", () => ({
  t: (key: string) => key,
  tFrom: (_catalogs: unknown, key: string) => key,
  useLocale() {},
  locale: createStore("en"),
}))
// `ui.ts` reads localStorage at import; each test still installs its own.
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  writable: true,
  value: { getItem: () => null, setItem() {} },
})
const { mountTerminal } = await import("../src/term-mount.ts")

const globals = ["window", "localStorage", "ResizeObserver", "document"] as const
const originals = globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
afterEach(() => {
  mock.restore()
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
})
function install(key: string, value: unknown) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
}
function protocol() {
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
  return { client, calls }
}
const flush = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function modelHarness() {
  const timers: Array<() => void> = []
  install("window", {
    setTimeout(fn: () => void) {
      timers.push(fn)
      return timers.length
    },
  })
  install("localStorage", {
    getItem() {
      return null
    },
    setItem() {},
  })
  const { client, calls } = protocol()
  const handlers = new Map<string, (data: unknown) => void>()
  spyOn(client, "on").mockImplementation((event, callback) => {
    handlers.set(event, callback)
    return () => {}
  })
  const push = (event: string, data: unknown) => handlers.get(event)?.(data)
  return { model: new AppModel(client), calls, timers, push }
}

test("a task arriving during the tab debounce gets its live tab without another snapshot", async () => {
  const { model, calls, timers, push } = modelHarness()
  calls[0].resolve({ tasks: [{ id: "A" }], attention: [] })
  await flush()
  push("tasks", { tasks: [{ id: "A" }, { id: "B" }], attention: [] })
  model.select("B")
  expect(timers).toHaveLength(1)
  timers.shift()?.()
  const requests = calls.filter((call) => call.op === "task.tabs")
  expect(requests.map((call) => call.args.taskId)).toEqual(["A", "B"])
  for (const call of requests) call.resolve({ tabs: [{ id: `${call.args.taskId}-tab`, alive: true }] })
  await flush()
  expect(model.selection.get()).toEqual({ taskId: "B", tabId: "B-tab" })
  expect(timers).toHaveLength(0)
})

test("a tab sweep that resolves after a newer one changes neither tabs nor selection", async () => {
  const { model, calls, timers, push } = modelHarness()
  calls[0].resolve({ tasks: [{ id: "A" }], attention: [] })
  await flush()
  timers.shift()?.()
  const first = calls.filter((call) => call.op === "task.tabs")
  push("tasks", { tasks: [{ id: "A" }], attention: [] })
  timers.shift()?.()
  const second = calls.filter((call) => call.op === "task.tabs" && !first.includes(call))
  expect(second).toHaveLength(1)
  second[0].resolve({ tabs: [{ id: "new", alive: true }] })
  await flush()
  model.select("A", "new")
  first[0].resolve({ tabs: [{ id: "old", alive: true }] })
  await flush()
  expect(model.tabs.get().A?.map((tab) => tab.id)).toEqual(["new"])
  expect(model.selection.get()).toEqual({ taskId: "A", tabId: "new" })
})

test("a tab-only change with an unchanged task list still updates the tabs", async () => {
  const { model, calls, timers, push } = modelHarness()
  calls[0].resolve({ tasks: [{ id: "A" }], attention: [] })
  await flush()
  timers.shift()?.()
  calls.find((call) => call.op === "task.tabs")?.resolve({ tabs: [{ id: "tab-1", title: "old", alive: true }] })
  await flush()
  const before = calls.length
  push("tabs", { taskIds: ["A"] })
  timers.shift()?.()
  const sweep = calls.slice(before).filter((call) => call.op === "task.tabs")
  expect(sweep).toHaveLength(1)
  sweep[0].resolve({
    tabs: [
      { id: "tab-1", title: "renamed", alive: true },
      { id: "tab-2", title: null, alive: true },
    ],
  })
  await flush()
  expect(model.tabs.get().A?.map((tab) => [tab.id, tab.title])).toEqual([
    ["tab-1", "renamed"],
    ["tab-2", null],
  ])
})

test("selecting a task with no worktree materializes it once, then selects it", async () => {
  const { model, calls } = modelHarness()
  calls[0].resolve({ tasks: [{ id: "A" }, { id: "B", noWorktree: true }], attention: [] })
  await flush()
  model.select("A")
  model.select("B")
  model.select("B")
  const ensures = calls.filter((call) => call.op === "task.ensureWorktree")
  expect(ensures.map((call) => call.args.taskId)).toEqual(["B"])
  expect(model.selection.get().taskId).toBe("A")
  ensures[0].resolve({ worktreePath: "/wt/B" })
  await flush()
  expect(model.selection.get().taskId).toBe("B")
  model.select("B")
  expect(calls.filter((call) => call.op === "task.ensureWorktree")).toHaveLength(1)
})

test("a failed worktree materialization leaves the selection where it was", async () => {
  const { model, calls } = modelHarness()
  calls[0].resolve({ tasks: [{ id: "A" }, { id: "B", noWorktree: true }], attention: [] })
  await flush()
  model.select("A")
  model.select("B")
  calls.find((call) => call.op === "task.ensureWorktree")?.reject(new Error("repo is gone"))
  await flush()
  expect(model.selection.get().taskId).toBe("A")
})

test("switching away while a worktree is materializing keeps the newer selection", async () => {
  const { model, calls } = modelHarness()
  calls[0].resolve({ tasks: [{ id: "A" }, { id: "B", noWorktree: true }], attention: [] })
  await flush()
  model.select("A")
  model.select("B")
  model.select("A")
  calls.find((call) => call.op === "task.ensureWorktree")?.resolve({ worktreePath: "/wt/B" })
  await flush()
  expect(model.selection.get().taskId).toBe("A")
  // Provisioned anyway: the next click selects B at once, without a second request.
  model.select("B")
  expect(model.selection.get().taskId).toBe("B")
  expect(calls.filter((call) => call.op === "task.ensureWorktree")).toHaveLength(1)
})

test("two materializations resolving out of order leave the last click selected", async () => {
  const { model, calls } = modelHarness()
  calls[0].resolve({
    tasks: [{ id: "A" }, { id: "B", noWorktree: true }, { id: "C", noWorktree: true }],
    attention: [],
  })
  await flush()
  model.select("A")
  model.select("B")
  model.select("C")
  const ensure = (id: string) => calls.find((call) => call.op === "task.ensureWorktree" && call.args.taskId === id)
  ensure("C")?.resolve({ worktreePath: "/wt/C" })
  await flush()
  expect(model.selection.get().taskId).toBe("C")
  ensure("B")?.resolve({ worktreePath: "/wt/B" })
  await flush()
  expect(model.selection.get().taskId).toBe("C")
  expect(model.tasks.get()?.tasks.filter((task) => task.noWorktree)).toEqual([])
})

test("a task removed while its worktree materializes is not selected", async () => {
  const { model, calls, push } = modelHarness()
  calls[0].resolve({ tasks: [{ id: "A" }, { id: "B", noWorktree: true }], attention: [] })
  await flush()
  model.select("A")
  model.select("B")
  push("tasks", { tasks: [{ id: "A" }], attention: [] })
  calls.find((call) => call.op === "task.ensureWorktree")?.resolve({ worktreePath: "/wt/B" })
  await flush()
  expect(model.selection.get().taskId).toBe("A")
})

test("the page reports what it shows to the daemon, and nothing once hidden", async () => {
  let onVisibility = () => {}
  const page = {
    visibilityState: "visible",
    addEventListener(_: string, fn: () => void) {
      onVisibility = fn
    },
  }
  install("document", page)
  const { model, calls, timers } = modelHarness()
  calls[0].resolve({ tasks: [{ id: "A" }], attention: [] })
  await flush()
  timers.shift()?.()
  calls.find((call) => call.op === "task.tabs")?.resolve({ tabs: [{ id: "tab-1", alive: true }] })
  await flush()
  const viewing = () => calls.filter((call) => call.op === "ui.viewing").map((call) => call.args)
  // Nothing selected on a fresh socket: nothing to report.
  expect(viewing()).toEqual([])
  model.select("A")
  model.select("A", "tab-1")
  expect(viewing()).toEqual([{ taskId: "A", tabId: "tab-1" }])
  page.visibilityState = "hidden"
  onVisibility()
  page.visibilityState = "visible"
  onVisibility()
  expect(viewing()).toEqual([{ taskId: "A", tabId: "tab-1" }, { taskId: null }, { taskId: "A", tabId: "tab-1" }])
})

function terminals() {
  install("document", { addEventListener() {}, removeEventListener() {}, activeElement: null })
  install(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  )
  const { client, calls } = protocol()
  const el = { addEventListener() {}, removeEventListener() {}, style: {} } as unknown as HTMLElement
  const mount = (tab: string) =>
    mountTerminal({
      client,
      el,
      taskId: "task",
      tabId: tab,
      setNotice() {},
      onScrolled() {},
      onFocusChange() {},
      onExit() {},
      copyText: async () => true,
      focusOnMount: false,
    }).dispose
  const resolve = async (index: number) => {
    const call = calls.filter((call) => call.op === "term.attach")[index]
    call.resolve({ stream: `task::${call.args.tabId}`, alive: true, replay: "" })
    await flush()
  }
  const detached = () => calls.filter((call) => call.op === "term.detach").map((call) => call.args.stream)
  return { mount, resolve, detached }
}

test("switching tabs releases an attachment that succeeds after unmount", async () => {
  const t = terminals()
  const first = t.mount("A")
  first()
  const second = t.mount("B")
  await t.resolve(0)
  expect(t.detached()).toEqual(["task::A"])
  await t.resolve(1)
  second()
  expect(t.detached()).toEqual(["task::A", "task::B"])
})

for (const order of [
  [0, 1],
  [1, 0],
]) {
  test(`late attachment leaves a newer owner of the same stream attached: ${order}`, async () => {
    const t = terminals()
    const first = t.mount("A")
    first()
    const second = t.mount("A")
    for (const index of order) await t.resolve(index)
    expect(t.detached()).toEqual([])
    second()
    expect(t.detached()).toEqual(["task::A"])
  })
}

test("all views can close before either same-stream attachment replies", async () => {
  const t = terminals()
  const first = t.mount("A")
  first()
  const second = t.mount("A")
  second()
  await t.resolve(1)
  await t.resolve(0)
  expect(t.detached()).toEqual(["task::A", "task::A"])
})

test("a late reply is released even after the newer same-stream view has closed", async () => {
  const t = terminals()
  const first = t.mount("A")
  first()
  const second = t.mount("A")
  await t.resolve(1)
  second()
  await t.resolve(0)
  expect(t.detached()).toEqual(["task::A", "task::A"])
})
