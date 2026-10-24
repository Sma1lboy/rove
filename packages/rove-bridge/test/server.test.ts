import { afterEach, describe, expect, test } from "bun:test"
import { ROVE_API_VERSION } from "@sma1lboy/rove-daemon/daemon/protocol"
import { AccessDenied, type AccessVerifier } from "../src/cf-access.ts"
import { TaskFeed } from "../src/feed.ts"
import { GATE_OPS } from "../src/ops/gates.ts"
import type { OpTable } from "../src/ops/types.ts"
import type { TasksPayload } from "../src/protocol.ts"
import type { RoveOps } from "../src/rove-ops.ts"
import { TabFeed } from "../src/tab-feed.ts"
import { AUTH, ROWS, TOKEN, connect, fakeOps, start, stopServers, upgradeStatus } from "./server-harness.ts"

afterEach(stopServers)
describe("auth", () => {
  test("no token, a wrong token, a same-length wrong token, and a query-string token are all refused", async () => {
    const h = start()
    expect(await upgradeStatus(h.url)).toBe(401)
    expect(await upgradeStatus(h.url, { Authorization: "Bearer nope" })).toBe(401)
    expect(await upgradeStatus(h.url, { Authorization: `Bearer ${"x".repeat(43)}` })).toBe(401)
    // Tunnels and proxies log URLs; only the pairing QR may carry the token.
    expect(await upgradeStatus(`${h.url}?token=${TOKEN}`)).toBe(401)
  })

  test("the right Bearer header opens a socket", async () => {
    const h = start()
    const c = await connect(h.url, AUTH)
    expect((await c.call("hello")).ok).toBe(true)
  })
})

describe("cloudflare access layer", () => {
  const access: AccessVerifier = {
    async verify(assertion) {
      if (assertion !== "good-jwt")
        throw new AccessDenied(assertion ? "bad JWT signature" : "missing Cf-Access-Jwt-Assertion header")
    },
  }

  test("both layers must pass: a valid token without an Access JWT is refused and logged without secrets", async () => {
    const lines: string[] = []
    const h = start({ access, log: (line) => lines.push(line) })
    expect(await upgradeStatus(h.url, AUTH)).toBe(401)
    expect(await upgradeStatus(h.url, { ...AUTH, "Cf-Access-Jwt-Assertion": "forged" })).toBe(401)
    expect(await upgradeStatus(h.url, { "Cf-Access-Jwt-Assertion": "good-jwt" })).toBe(401)
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain("missing Cf-Access-Jwt-Assertion")
    expect(lines.join("\n")).not.toContain(TOKEN)
    expect(lines.join("\n")).not.toContain("forged")
  })

  test("a valid Access JWT plus the token opens a socket", async () => {
    const h = start({ access })
    const c = await connect(h.url, { ...AUTH, "Cf-Access-Jwt-Assertion": "good-jwt" })
    expect((await c.call("hello")).ok).toBe(true)
  })
})

describe("api.invoke", () => {
  test("serves the verb contract: hello names its version, a refusal keeps its recovery data, a destructive verb is audited", async () => {
    const lines: string[] = []
    const invoked: Array<[string, unknown]> = []
    const h = start({
      log: (line) => lines.push(line),
      invoke: async (verb, params) => {
        invoked.push([verb, params])
        if (verb === "land") {
          return {
            apiVersion: ROVE_API_VERSION,
            ok: false,
            error: { code: "LAND_CONFLICT", message: "conflict", hint: "rebase first", files: ["a.ts"] },
          }
        }
        return { apiVersion: ROVE_API_VERSION, ok: true, result: { tasks: [] } }
      },
    })
    const c = await connect(h.url, AUTH)
    lines.length = 0
    expect((await c.call("hello")).result).toMatchObject({ apiVersion: ROVE_API_VERSION })
    expect(await c.call("api.invoke", { verb: "list", params: { repo: "/r" } })).toMatchObject({
      ok: true,
      result: { tasks: [] },
    })
    expect(await c.call("api.invoke", { verb: "land", params: { "task-id": "T1" } })).toMatchObject({
      ok: false,
      error: { code: "LAND_CONFLICT", message: "conflict", hint: "rebase first", files: ["a.ts"] },
    })
    expect(invoked).toEqual([
      ["list", { repo: "/r" }],
      ["land", { "task-id": "T1" }],
    ])
    expect(lines).toEqual(["[rove-bridge] api.invoke land task-id=T1"])
  })
})

describe("op allowlist", () => {
  test("an op outside the allowlist is refused by name, not passed to the daemon", async () => {
    const h = start()
    const c = await connect(h.url, AUTH)
    const res = await c.call("task.setActive", { taskId: "T1" })
    expect(res.error?.code).toBe("UNKNOWN_OP")
  })

  test("a malformed frame gets an error reply instead of killing the socket", async () => {
    const h = start()
    const c = await connect(h.url, AUTH)
    const bad = Promise.withResolvers<string>()
    c.ws.addEventListener("message", (e) => bad.resolve(String(e.data)), { once: true })
    c.ws.send("{not json")
    expect(JSON.parse(await bad.promise).error.code).toBe("BAD_FRAME")
    expect((await c.call("hello")).ok).toBe(true)
  })

  test("a registered area op runs on the authenticated socket; a destructive one is audited by id, never the token", async () => {
    const lines: string[] = []
    const calls: string[] = []
    const areaOps: OpTable = {
      "demo.read": { kind: "read", destructive: false, wraps: "test", run: async () => ({ ok: 1 }) },
      "demo.remove": {
        kind: "write",
        destructive: true,
        wraps: "test",
        run: async (args) => {
          calls.push(String(args.taskId))
          return {}
        },
      },
    }
    const h = start({ areaOps, log: (line) => lines.push(line) })
    expect(await upgradeStatus(h.url)).toBe(401)
    const c = await connect(h.url, AUTH)
    lines.length = 0 // drop the refused-upgrade line above
    expect((await c.call("demo.read")).result).toEqual({ ok: 1 })
    expect(lines).toHaveLength(0)
    await c.call("demo.remove", { taskId: "T7", secret: "s3cret" })
    expect(calls).toEqual(["T7"])
    expect(lines).toEqual(["[rove-bridge] demo.remove taskId=T7"])
    expect(lines.join("\n")).not.toContain(TOKEN)
    expect(lines.join("\n")).not.toContain("s3cret")
    expect((await c.call("demo.other")).error?.code).toBe("UNKNOWN_OP")
  })
})

describe("op.progress", () => {
  test("an op's progress lines reach only the socket that asked, tagged with that request's id, before its reply", async () => {
    const areaOps: OpTable = {
      "demo.slow": {
        kind: "read",
        destructive: false,
        wraps: "test",
        run: async (_args, ctx) => {
          ctx.progress?.("one")
          ctx.progress?.("two")
          return {}
        },
      },
    }
    const h = start({ areaOps })
    const asker = await connect(h.url, AUTH)
    const bystander = await connect(h.url, AUTH)
    await asker.call("demo.slow")
    expect(asker.pushes.filter((p) => p.event === "op.progress").map((p) => p.data)).toEqual([
      { id: 1, line: "one" },
      { id: 1, line: "two" },
    ])
    expect(bystander.pushes.filter((p) => p.event === "op.progress")).toEqual([])
  })
})

describe("tab.new", () => {
  test("without a prompt it opens an empty tab (engine by default); a shell with a prompt or engine is BAD_ARGS", async () => {
    const seen: Array<[string, unknown]> = []
    const newTab: RoveOps["newTab"] = async (taskId, tab) => {
      seen.push([taskId, tab])
      return { tabId: "tab-3" }
    }
    const h = start({ ops: { ...fakeOps(), newTab } })
    const c = await connect(h.url, AUTH)

    expect((await c.call("tab.new", { taskId: "T1", kind: "shell" })).result).toEqual({ tabId: "tab-3" })
    expect((await c.call("tab.new", { taskId: "T1" })).result).toEqual({ tabId: "tab-3" })
    // An old client: prompt + engine, no kind.
    await c.call("tab.new", { taskId: "T1", prompt: "go", engine: "codex" })
    expect(seen).toEqual([
      ["T1", { kind: "shell", prompt: undefined, engine: undefined }],
      ["T1", { kind: "engine", prompt: undefined, engine: undefined }],
      ["T1", { kind: "engine", prompt: "go", engine: "codex" }],
    ])

    seen.length = 0
    for (const args of [
      { taskId: "T1", kind: "shell", prompt: "go" },
      { taskId: "T1", kind: "shell", engine: "codex" },
      { taskId: "T1", kind: "terminal" },
    ]) {
      expect((await c.call("tab.new", args)).error?.code).toBe("BAD_ARGS")
    }
    expect(seen).toEqual([])
  })
})

describe("task feed", () => {
  test("a subscriber gets the snapshot, then a push when a row changes or a new episode starts, not when only its age ticks", async () => {
    const h = start()
    const c = await connect(h.url, AUTH)
    const first = await c.call("tasks.subscribe")
    expect(first.result).toEqual(ROWS)
    const row = {
      id: "T1",
      title: "t",
      branch: "b",
      repo: "/r",
      kind: "task",
      status: "backlog",
      group: "working" as const,
      rank: 3,
      activity: { state: "running", forMs: 1, since: 5000 },
      engine: null,
      pr: null,
      report: null,
      deleting: false,
    }
    h.setRows({ tasks: [row], attention: [], gates: [] })
    await h.feed.refresh()
    h.setRows({
      tasks: [{ ...row, activity: { state: "running", forMs: 9000, since: 5000 } }],
      attention: [],
      gates: [],
    })
    await h.feed.refresh()
    // Same state, but the next turn: the phone must rebase its timer.
    h.setRows({ tasks: [{ ...row, activity: { state: "running", forMs: 2, since: 60000 } }], attention: [], gates: [] })
    await h.feed.refresh()
    // The socket is FIFO: a reply after the refreshes trails any push they sent.
    await c.call("hello")
    expect(c.pushes.filter((p) => p.event === "tasks")).toHaveLength(2)
  })

  test("a later subscriber gets the cached list without a read, its timers aged to now", async () => {
    let clock = 1_000_000
    let reads = 0
    const row = {
      id: "T1",
      title: "t",
      branch: "b",
      repo: "/r",
      kind: "task",
      status: "backlog",
      group: "working" as const,
      rank: 3,
      activity: { state: "running", forMs: 4000 },
      engine: null,
      pr: null,
      report: null,
      deleting: false,
    }
    const feed = new TaskFeed(
      async () => {
        reads++
        return { tasks: [row], attention: [], gates: [] }
      },
      () => clock,
    )
    await feed.current()
    clock += 7000
    const later = await feed.current()
    expect(reads).toBe(1)
    expect(later.tasks[0]?.activity?.forMs).toBe(11_000)
  })

  test("a task subscriber gets a tabs push naming the tasks whose tabs changed", async () => {
    let state: Record<string, unknown> = { "terminalTabs.T1": { tabs: [{ id: "tab-1", title: "old" }] } }
    const tabs = new TabFeed(() => state)
    const h = start({ tabs })
    const c = await connect(h.url, AUTH)
    await c.call("tasks.subscribe")
    state = { "terminalTabs.T1": { tabs: [{ id: "tab-1", title: "new" }, { id: "tab-2" }] } }
    tabs.check()
    await c.call("hello")
    expect(c.pushes.filter((p) => p.event === "tabs")).toEqual([{ event: "tabs", data: { taskIds: ["T1"] } }])
  })
})

describe("terminal forwarding", () => {
  test("attach replays the shared session, forwards only attached streams, and input reaches the PTY", async () => {
    const h = start()
    const c = await connect(h.url, AUTH)

    const early = await c.call("term.input", { stream: "T1::tab-1", data: "x" })
    expect(early.error?.code).toBe("NOT_ATTACHED")

    const attached = await c.call("term.attach", { taskId: "T1", tabId: "tab-1" })
    expect(attached.result).toEqual({
      stream: "T1::tab-1",
      alive: true,
      replay: Buffer.from("hello").toString("base64"),
    })
    // Size-less attach must not resize the session the TUI is also drawing.
    const open = h.pty.calls.find(([n]) => n === "pty.open")?.[1] as Record<string, unknown>
    expect(open.cols).toBeUndefined()

    h.pty.emit("pty.data", { key: "T1::tab-1", data: "AAA=" })
    h.pty.emit("pty.data", { key: "OTHER::tab-1", data: "BBB=" })
    await c.call("term.input", { stream: "T1::tab-1", data: "yes\r" })
    expect(h.pty.calls).toContainEqual(["pty.write", { key: "T1::tab-1", data: "yes\r" }])
    expect(c.pushes.filter((p) => p.event === "term.data")).toEqual([
      { event: "term.data", data: { stream: "T1::tab-1", data: "AAA=" } },
    ])

    await c.call("term.detach", { stream: "T1::tab-1" })
    h.pty.emit("pty.data", { key: "T1::tab-1", data: "CCC=" })
    await c.call("hello")
    expect(c.pushes.filter((p) => p.event === "term.data")).toHaveLength(1)
  })

  test("a viewport tab attaches the session it shows, under that session's own stream and cwd", async () => {
    const ops = {
      ...fakeOps(),
      viewedSession: (taskId: string, tabId: string) =>
        taskId === "MAIN" && tabId === "tab-2" ? { taskId: "T1", tabId: "tab-1", cwd: "/wt/shown" } : null,
    }
    const h = start({ ops })
    const c = await connect(h.url, AUTH)
    const attached = await c.call("term.attach", { taskId: "MAIN", tabId: "tab-2" })
    expect(attached.result).toMatchObject({ stream: "T1::tab-1", alive: true })
    expect(h.pty.calls.find(([n]) => n === "pty.open")?.[1]).toMatchObject({ key: "T1::tab-1", cwd: "/wt/shown" })
  })

  test("revive reopens the tab's own session, or the one a viewport tab shows, and never spawns through the PTY connection", async () => {
    const revived: Array<[string, string]> = []
    const ops = {
      ...fakeOps(),
      viewedSession: (taskId: string, tabId: string) =>
        taskId === "MAIN" && tabId === "tab-2" ? { taskId: "T1", tabId: "tab-1", cwd: "/wt/shown" } : null,
      reviveTab: async (taskId: string, tabId: string) => {
        revived.push([taskId, tabId])
        return { revived: true, resumed: true }
      },
    }
    const h = start({ ops })
    const c = await connect(h.url, AUTH)

    expect((await c.call("term.revive", { taskId: "T1", tabId: "tab-3" })).result).toEqual({
      revived: true,
      resumed: true,
    })
    await c.call("term.revive", { taskId: "MAIN", tabId: "tab-2" })

    expect(revived).toEqual([
      ["T1", "tab-3"],
      ["T1", "tab-1"],
    ])
    expect(h.pty.calls.some(([n]) => n === "pty.open")).toBe(false)
  })

  test("attach never spawns: an unknown tab is refused and a restored corpse is only peeked", async () => {
    const h = start()
    const c = await connect(h.url, AUTH)
    expect((await c.call("term.attach", { taskId: "T1", tabId: "tab-9" })).error?.code).toBe("TAB_NOT_LIVE")
    const frozen = await c.call("term.attach", { taskId: "T1", tabId: "tab-2" })
    expect(frozen.result).toMatchObject({
      alive: false,
      restored: true,
      replay: Buffer.from("frozen").toString("base64"),
    })
    expect(h.pty.calls.some(([n]) => n === "pty.open")).toBe(false)
  })

  test("with no PTY host process every tab is not live, so a client can offer to reopen it", async () => {
    const h = start()
    h.pty.hostDown = true
    const c = await connect(h.url, AUTH)
    expect((await c.call("term.attach", { taskId: "T1", tabId: "tab-1" })).error?.code).toBe("TAB_NOT_LIVE")
  })

  test("fit-to-phone attach carries the phone's size; closing the socket releases the PTY connection", async () => {
    const h = start()
    const c = await connect(h.url, AUTH)
    await c.call("term.attach", { taskId: "T1", tabId: "tab-1", cols: 48, rows: 30 })
    const open = h.pty.calls.find(([n]) => n === "pty.open")?.[1]
    expect(open).toMatchObject({ key: "T1::tab-1", cols: 48, rows: 30 })
    c.ws.close()
    await h.pty.closed.promise
  })
})

describe("attention.dismiss", () => {
  test("a report_missing dismissal carries its deliveryId through to the daemon op", async () => {
    const seen: unknown[][] = []
    const ops = { ...fakeOps(), dismissAttention: async (...a: unknown[]) => void seen.push(a) } as RoveOps
    const h = start({ ops })
    const c = await connect(h.url, AUTH)
    expect((await c.call("attention.dismiss", { taskId: "T1", deliveryId: "d-12" })).ok).toBe(true)
    expect(seen).toEqual([["T1", undefined, "d-12"]])
  })

  describe("gate rows", () => {
    const decision = { taskId: "T1", tabId: "tab-1", state: "decision_needed", unread: true, at: 1, gateId: "g-4" }
    const other = { taskId: "T1", tabId: "tab-1", state: "turn_complete", unread: true, at: 2 }

    async function dismissWith(attention: TasksPayload["attention"], args: Record<string, unknown>) {
      const seen: unknown[][] = []
      const ops = { ...fakeOps(), dismissAttention: async (...a: unknown[]) => void seen.push(a) } as RoveOps
      const h = start({ ops })
      h.setRows({ tasks: [], attention, gates: [] })
      const c = await connect(h.url, AUTH)
      return { reply: await c.call("attention.dismiss", args), seen }
    }

    test("a dismissal that names the gate is refused and touches nothing", async () => {
      const { reply, seen } = await dismissWith([decision], { taskId: "T1", tabId: "tab-1", gateId: "g-4" })
      expect(reply.error?.code).toBe("GATE_NOT_DISMISSABLE")
      expect(seen).toEqual([])
    })

    test("a client that predates gateId cannot dismiss a tab that holds only a decision", async () => {
      const { reply, seen } = await dismissWith([decision], { taskId: "T1", tabId: "tab-1" })
      expect(reply.error?.code).toBe("GATE_NOT_DISMISSABLE")
      expect(seen).toEqual([])
    })

    test("a tab that also holds an ordinary episode still dismisses that episode", async () => {
      const { reply, seen } = await dismissWith([decision, other], { taskId: "T1", tabId: "tab-1" })
      expect(reply.ok).toBe(true)
      expect(seen).toEqual([["T1", "tab-1", undefined]])
    })
  })
})

describe("gate.answer", () => {
  test("is served over the socket and reaches the daemon as the bridge", async () => {
    const calls: unknown[] = []
    const h = start({
      areaOps: GATE_OPS,
      api: {
        verb: async () => {
          throw new Error("no verbs")
        },
        rpc: async (name, payload) => {
          calls.push([name, payload])
          return { delivered: true } as never
        },
      },
    })
    const c = await connect(h.url, AUTH)
    const reply = await c.call("gate.answer", { gateId: "g-2", option: "a", text: "go" })
    expect(reply).toMatchObject({ ok: true, result: { delivered: true } })
    expect(calls).toEqual([["gate.answer", { gateId: "g-2", option: "a", text: "go", by: "bridge" }]])
  })

  test("the default allowlist knows it", async () => {
    const h = start({ areaOps: undefined })
    const c = await connect(h.url, AUTH)
    // Not UNKNOWN_OP: the id check, not the allowlist, refuses this one.
    expect((await c.call("gate.answer", { gateId: "nope" })).error?.code).toBe("BAD_ARGS")
  })
})
