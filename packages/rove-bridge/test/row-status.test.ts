import { afterEach, describe, expect, test } from "bun:test"
import type { TaskStatus } from "@sma1lboy/rove-daemon/daemon/row-status"
import { RowStatusFeed, type StatusClient } from "../src/row-status.ts"
import { AUTH, connect, start, stopServers } from "./server-harness.ts"

afterEach(stopServers)

/** A daemon double: answers `status.list`, records the reports, pushes `row.status` on demand. */
class FakeDaemon implements StatusClient {
  readonly calls: Array<[string, unknown]> = []
  list: unknown = { tasks: {}, rev: 0 }
  private handler: ((frame: { payload: unknown }) => void) | null = null
  async request(name: string, payload?: unknown): Promise<unknown> {
    this.calls.push([name, payload])
    return name === "status.list" ? this.list : { ok: true }
  }
  on(_name: "row.status", handler: (frame: { payload: unknown }) => void): () => void {
    this.handler = handler
    return () => {
      this.handler = null
    }
  }
  push(payload: unknown): void {
    this.handler?.({ payload })
  }
  reports(name: string): unknown[] {
    return this.calls.filter(([n]) => n === name).map(([, p]) => p)
  }
}

const status = (kind: TaskStatus["task"]["kind"], tabKind = kind): TaskStatus => ({
  task: { kind, since: 1 },
  tabs: { "tab-1": { kind: tabKind, since: 1, alive: true, restored: false, tracked: true } },
})

const until = async (check: () => boolean): Promise<void> => {
  for (let i = 0; i < 100 && !check(); i++) await Bun.sleep(5)
}

describe("the bridge's copy of row.status", () => {
  test("takes the snapshot on (re)connect, then keeps only newer pushes", async () => {
    const daemon = new FakeDaemon()
    const feed = new RowStatusFeed(daemon)
    let changes = 0
    feed.subscribe(() => changes++)
    expect(feed.current()).toBeNull()
    daemon.list = { tasks: { T1: status("running") }, rev: 4 }
    await feed.resync()
    expect(feed.current()?.T1?.task.kind).toBe("running")
    daemon.push({ tasks: { T1: status("needs-input") }, rev: 3 })
    expect(feed.current()?.T1?.task.kind).toBe("running")
    daemon.push({ tasks: { T1: status("needs-input") }, rev: 5 })
    expect(feed.current()?.T1?.task.kind).toBe("needs-input")
    // A restarted daemon counts from zero again: its snapshot is taken as is.
    daemon.list = { tasks: { T1: status("idle") }, rev: 1 }
    await feed.resync()
    expect(feed.current()?.T1?.task.kind).toBe("idle")
    daemon.push({ tasks: {}, rev: "x" })
    expect(changes).toBe(3)
  })

  test("re-reports what each browser shows after a reconnect", async () => {
    const daemon = new FakeDaemon()
    const feed = new RowStatusFeed(daemon)
    feed.setViewing("bridge-1", "T1", "tab-1")
    feed.setViewing("bridge-1", "T1", "tab-1")
    feed.setViewing("bridge-2", "T2", null)
    expect(daemon.reports("ui.viewing")).toHaveLength(2)
    await feed.resync()
    expect(daemon.reports("ui.viewing").slice(2)).toEqual([
      { viewer: "bridge-1", taskId: "T1", tabId: "tab-1" },
      { viewer: "bridge-2", taskId: "T2" },
    ])
  })

  test("Enter into a tab that is asking answers it; any other keystroke does not", async () => {
    const daemon = new FakeDaemon()
    daemon.list = { tasks: { T1: status("needs-input"), T2: status("running") }, rev: 1 }
    const feed = new RowStatusFeed(daemon)
    await feed.resync()
    feed.noteInput("T1::tab-1", "y")
    feed.noteInput("T2::tab-1", "\r")
    expect(daemon.reports("activity.answered")).toEqual([])
    feed.noteInput("T1::tab-1::leaf-1", "1\r")
    expect(daemon.reports("activity.answered")).toEqual([{ taskId: "T1", tabId: "tab-1" }])
  })
})

describe("ui.viewing over the bridge", () => {
  test("each browser connection reports as its own viewer, cleared when it disconnects", async () => {
    const daemon = new FakeDaemon()
    const h = start({ rowStatus: new RowStatusFeed(daemon) })
    const a = await connect(h.url, AUTH)
    const b = await connect(h.url, AUTH)
    expect((await a.call("ui.viewing", { taskId: "T1", tabId: "tab-1" })).ok).toBe(true)
    expect((await b.call("ui.viewing", { taskId: "T2" })).ok).toBe(true)
    const [first, second] = daemon.reports("ui.viewing") as Array<{ viewer: string }>
    expect(first).toMatchObject({ taskId: "T1", tabId: "tab-1" })
    expect(second).toMatchObject({ taskId: "T2" })
    expect(first?.viewer).toBeString()
    expect(first?.viewer).not.toBe(second?.viewer)
    // The page went hidden: nothing shown.
    expect((await b.call("ui.viewing", { taskId: null })).ok).toBe(true)
    expect(daemon.reports("ui.viewing")[2]).toEqual({ viewer: second?.viewer, taskId: null })
    a.ws.close()
    await until(() => daemon.reports("ui.viewing").length === 4)
    expect(daemon.reports("ui.viewing")[3]).toEqual({ viewer: first?.viewer, taskId: null })
    b.ws.close()
    await Bun.sleep(20)
    // b already showed nothing: no second clear.
    expect(daemon.reports("ui.viewing")).toHaveLength(4)
  })

  test("refuses a task id that is not a string", async () => {
    const h = start({ rowStatus: new RowStatusFeed(new FakeDaemon()) })
    const c = await connect(h.url, AUTH)
    expect((await c.call("ui.viewing", { taskId: 7 })).error?.code).toBe("BAD_ARGS")
  })
})
