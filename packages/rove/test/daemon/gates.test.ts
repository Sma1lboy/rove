import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AttentionInboxStore } from "@sma1lboy/rove-daemon/daemon/attention-inbox"
import { DeliveriesStore } from "@sma1lboy/rove-daemon/daemon/deliveries-store"
import { DaemonEventBus } from "@sma1lboy/rove-daemon/daemon/event-bus"
import { GatesStore, MAX_CLOSED_GATES } from "@sma1lboy/rove-daemon/daemon/gates-store"
import type { DaemonRequestName } from "@sma1lboy/rove-daemon/daemon/protocol"
import {
  type DaemonHandlerContext,
  createDaemonHandlerRegistry,
  dispatchDaemonRequest,
} from "@sma1lboy/rove-daemon/daemon/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { dispatchAutomation } from "../../../rove-daemon/src/daemon/automation-dispatch.ts"
import { AutomationsStore } from "../../../rove-daemon/src/daemon/automations-store.ts"
import type { AttentionInboxItem, DaemonTask, Gate } from "../../../rove-daemon/src/daemon/contracts.ts"
import { NOW, REPO, automation, fakeDeps } from "./automation-runner-fixtures.ts"
import { fakeCtx } from "./handler-test-context.ts"

type Delivery = { tabId?: string; text: string }

interface GateRpc {
  gate: Gate
  gates: Gate[]
  items: AttentionInboxItem[]
  delivered: boolean
  text: string | null
  gateIds: string[]
}
type Call = (name: DaemonRequestName, payload?: Record<string, unknown>) => Promise<GateRpc>

const TASK = {
  id: "t1",
  title: "Worker",
  repo: "/repo",
  worktreePath: "/repo",
  kind: "task",
  status: "in_progress",
  branch: "feat/x",
  createdAt: new Date(NOW).toISOString(),
  updatedAt: new Date(NOW).toISOString(),
} satisfies DaemonTask

describe("decision gates", () => {
  const dirs: string[] = []
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
  })

  /** Real stores wired exactly as `initDaemonStores` wires them; fake engine delivery. */
  async function setup(opts: { engine?: "live" | "none"; requireReport?: boolean } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "rove-gates-"))
    dirs.push(dir)
    const bus = new DaemonEventBus()
    const published: Array<{ channel: string; payload: unknown }> = []
    bus.onPublish((e) => published.push({ channel: e.channel, payload: e.payload }))
    const inbox = new AttentionInboxStore(join(dir, "attention-inbox.json"), bus, () => 100)
    await inbox.init()
    const gates = new GatesStore(join(dir, "gates.json"), () => new Date("2026-10-12T00:00:00.000Z"))
    inbox.setProjection(() => gates.inboxItems())
    gates.setOnChange(() => {
      bus.publish("gates", { gates: gates.active() })
      inbox.publish()
    })
    await gates.init()
    const deliveries = new DeliveriesStore(join(dir, "deliveries.json"))
    await deliveries.init()

    const delivered: Delivery[] = []
    const engine = opts.engine ?? "live"
    const deliver = async (target: { tabId?: string }, text: string) => {
      if (engine === "none") return { outcome: "no-session" as const }
      delivered.push({ ...(target.tabId ? { tabId: target.tabId } : {}), text })
      return { outcome: "delivered" as const, tabId: target.tabId ?? "tab-1" }
    }
    const task = opts.requireReport ? { ...TASK, requireReport: true } : TASK
    const base = fakeCtx({
      getTask: (id: string) => (id === TASK.id ? task : undefined),
      setWorkerReport: async () => {},
    })
    const ctx: DaemonHandlerContext = {
      ...base.ctx,
      inbox,
      gates,
      deliveries,
      runtime: {
        ...base.ctx.runtime,
        deliverPromptToLiveEngineTabDetailed: deliver,
        deliverPromptToLiveEngineDetailed: (_task: unknown, text: string) => deliver({}, text),
      } as unknown as DaemonHandlerContext["runtime"],
    }
    // The registry answers `unknown`; every gate verb returns this shape.
    const call: Call = (name, payload = {}) =>
      dispatchDaemonRequest(createDaemonHandlerRegistry(), name, payload, ctx) as Promise<GateRpc>
    const rows = async () => (await call("attention.list")).items
    return { dir, bus, published, inbox, gates, deliveries, ctx, call, rows, delivered }
  }

  describe("with delivery reports", () => {
    it("raising a gate reports the tab's armed delivery as blocked, so it is not report_missing", async () => {
      const s = await setup()
      const armed = await s.deliveries.arm({ taskId: TASK.id, tabId: "tab-2", source: "send", promptHead: "tick" })
      await raise(s.call)
      expect(s.deliveries.get(armed.id)).toMatchObject({
        status: "reported",
        report: { outcome: "blocked", summary: "Ship the migration now?", next: "awaiting owner decision g-1" },
      })
    })

    it("raising with nothing armed is just a gate", async () => {
      const s = await setup()
      await expect(raise(s.call)).resolves.toMatchObject({ gate: { id: "g-1" } })
    })

    it("a gate row and a report_missing row coexist under different keys", async () => {
      const s = await setup()
      await raise(s.call)
      await s.inbox.recordReportMissing(TASK.id, "tab-2", { id: "d-1", cause: "turn-complete" }, undefined, 100)
      expect((await s.rows()).map((r) => r.state).sort()).toEqual(["decision_needed", "report_missing"])
    })

    it("answering a report-required task arms a gate-answer delivery whose footer rides the paste", async () => {
      const s = await setup({ requireReport: true })
      await raise(s.call)
      await s.call("gate.answer", { gateId: "g-1", option: "a" })
      const delivery = s.deliveries.awaitingFor(TASK.id, "tab-2")
      expect(delivery).toMatchObject({ source: "gate-answer", gateId: "g-1", tabId: "tab-2" })
      expect(s.delivered[0]?.text).toContain(`report --delivery ${delivery?.id} --outcome`)
    })

    it("a task without requireReport arms nothing", async () => {
      const s = await setup()
      await raise(s.call)
      await s.call("gate.answer", { gateId: "g-1", option: "a" })
      expect(s.deliveries.awaitingFor(TASK.id, "tab-2")).toBeUndefined()
      expect(s.delivered[0]?.text).not.toContain("report --delivery")
    })

    it("an answer that did not land cancels the delivery it armed", async () => {
      const s = await setup({ requireReport: true, engine: "none" })
      await raise(s.call)
      await s.call("gate.answer", { gateId: "g-1", option: "a" })
      expect(s.deliveries.awaitingFor(TASK.id, "tab-2")).toBeUndefined()
    })
  })

  const raise = (call: Call, over: Record<string, unknown> = {}) =>
    call("gate.raise", {
      taskId: TASK.id,
      tabId: "tab-2",
      question: "Ship the migration now?",
      options: [
        { key: "a", label: "ship now" },
        { key: "b", label: "wait for review" },
      ],
      recommended: "b",
      ...over,
    })

  it("a raised gate is a decision_needed row carrying its id and question", async () => {
    const s = await setup()
    const { gate } = await raise(s.call)
    expect(gate).toMatchObject({ id: "g-1", status: "open", tabId: "tab-2" })
    const [row] = await s.rows()
    expect(row).toMatchObject({
      taskId: TASK.id,
      tabId: "tab-2",
      state: "decision_needed",
      detail: { gate: { id: "g-1", question: "Ship the migration now?", recommended: "b" } },
    })
  })

  it("is announced on the gates channel and pushes the merged Inbox", async () => {
    const s = await setup()
    await raise(s.call)
    const channels = s.published.map((p) => p.channel)
    expect(channels).toContain("gates")
    const inboxPush = [...s.published].reverse().find((p) => p.channel === "attention.inbox")
    expect((inboxPush?.payload as { items: Array<{ state: string }> }).items.map((i) => i.state)).toEqual([
      "decision_needed",
    ])
  })

  it("survives the tab's turn-start and attention.dismiss; only an answer clears it", async () => {
    const s = await setup()
    await raise(s.call)
    await s.inbox.record(TASK.id, "turn-complete", undefined, "tab-2")
    expect((await s.rows()).map((r) => r.state).sort()).toEqual(["decision_needed", "turn_complete"])

    await s.inbox.record(TASK.id, "turn-start", undefined, "tab-2")
    const dismissed = await s.call("attention.dismiss", { taskId: TASK.id, tabId: "tab-2" })
    expect(dismissed).toEqual({ deleted: false })
    expect((await s.rows()).map((r) => r.state)).toEqual(["decision_needed"])

    await s.call("gate.answer", { gateId: "g-1", option: "a" })
    expect(await s.rows()).toEqual([])
  })

  it("never writes the projected row into attention-inbox.json", async () => {
    const s = await setup()
    await raise(s.call)
    await s.inbox.record(TASK.id, "turn-complete", undefined, "tab-9")
    const stored = JSON.parse(readFileSync(join(s.dir, "attention-inbox.json"), "utf8"))
    expect(JSON.stringify(stored)).not.toContain("decision_needed")
  })

  it("answering with a live engine pastes the text into the gate's tab, then closes the row", async () => {
    const s = await setup()
    await raise(s.call)
    const res = await s.call("gate.answer", { gateId: "g-1", option: "b", text: "after Friday" })
    expect(res.delivered).toBe(true)
    expect(res.gate).toMatchObject({ status: "answered", handoff: "delivered", answer: { option: "b", by: "cli" } })
    expect(s.delivered).toEqual([
      {
        tabId: "tab-2",
        text: "[ROVE GATE g-1 answered] Ship the migration now?\nAnswer: b — wait for review\nNote: after Friday",
      },
    ])
    expect(await s.rows()).toEqual([])
  })

  it("persists the answer even when delivery throws", async () => {
    const s = await setup()
    await raise(s.call)
    const runtime = s.ctx.runtime as unknown as Record<string, unknown>
    runtime.deliverPromptToLiveEngineTabDetailed = async () => {
      throw new Error("pty host gone")
    }
    const res = await s.call("gate.answer", { gateId: "g-1", text: "go" })
    expect(res.delivered).toBe(false)
    const onDisk = JSON.parse(readFileSync(join(s.dir, "gates.json"), "utf8"))
    expect(onDisk.gates[0]).toMatchObject({ status: "answered", handoff: "undelivered" })
  })

  it("with no live engine the answer stays owed: the row stays, the next send carries it once", async () => {
    const s = await setup({ engine: "none" })
    await raise(s.call)
    const res = await s.call("gate.answer", { gateId: "g-1", option: "a" })
    expect(res).toMatchObject({ delivered: false, gate: { status: "answered", handoff: "undelivered" } })
    const [row] = await s.rows()
    expect(row?.detail?.gate).toMatchObject({ id: "g-1", undelivered: true })

    // Another tab's send does not take it; the gate's own tab does.
    expect((await s.call("gate.takeUndelivered", { taskId: TASK.id, tabId: "tab-3" })).text).toBeNull()
    const owed = await s.call("gate.takeUndelivered", { taskId: TASK.id, tabId: "tab-2" })
    expect(owed.text).toBe("[ROVE GATE g-1 answered] Ship the migration now?\nAnswer: a — ship now")
    // Taking is read-only: a failed paste must not lose the answer.
    expect((await s.call("gate.takeUndelivered", { taskId: TASK.id, tabId: "tab-2" })).gateIds).toEqual(["g-1"])

    await s.call("gate.markDelivered", { gateIds: owed.gateIds })
    expect((await s.call("gate.takeUndelivered", { taskId: TASK.id, tabId: "tab-2" })).text).toBeNull()
    expect(await s.rows()).toEqual([])
    expect((await s.call("gate.list", { status: "answered" })).gates[0].handoff).toBe("delivered")
  })

  it("a routine firing into the gate's tab prepends the owed answer and marks it delivered", async () => {
    const s = await setup({ engine: "none" })
    await raise(s.call)
    await s.call("gate.answer", { gateId: "g-1", option: "a" })

    const dir = mkdtempSync(join(tmpdir(), "rove-gates-routine-"))
    dirs.push(dir)
    const store = new AutomationsStore(join(dir, "automations.json"), () => NOW)
    await store.init()
    const target = { kind: "existing-tab", taskId: TASK.id, tabId: "tab-2" } as const
    const deliverTab = vi.fn(async (t: { tabId: string }) => ({ outcome: "delivered" as const, tabId: t.tabId }))
    const f = fakeDeps({ store, tasks: { [TASK.id]: { ...TASK, repo: REPO, worktreePath: REPO } }, deliverTab })
    const routine = { ...automation(), target }

    await dispatchAutomation({ ...f.deps, link: () => f.deps.link, gates: s.gates }, routine, "TICK")
    expect(deliverTab).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: "tab-2" }),
      "[ROVE GATE g-1 answered] Ship the migration now?\nAnswer: a — ship now\n\nTICK",
    )
    expect(s.gates.get("g-1")?.handoff).toBe("delivered")

    await dispatchAutomation({ ...f.deps, link: () => f.deps.link, gates: s.gates }, routine, "TICK 2")
    expect(deliverTab).toHaveBeenLastCalledWith(expect.anything(), "TICK 2")
  })

  it("a routine firing that did not land leaves the answer owed", async () => {
    const s = await setup({ engine: "none" })
    await raise(s.call)
    await s.call("gate.answer", { gateId: "g-1", option: "a" })
    const dir = mkdtempSync(join(tmpdir(), "rove-gates-routine-"))
    dirs.push(dir)
    const store = new AutomationsStore(join(dir, "automations.json"), () => NOW)
    await store.init()
    const deliverTab = vi.fn(async (t: { tabId: string }) => ({ outcome: "no-engine" as const, tabId: t.tabId }))
    const f = fakeDeps({ store, tasks: { [TASK.id]: { ...TASK, repo: REPO, worktreePath: REPO } }, deliverTab })
    const routine = { ...automation(), target: { kind: "existing-tab", taskId: TASK.id, tabId: "tab-2" } as const }
    await dispatchAutomation({ ...f.deps, link: () => f.deps.link, gates: s.gates }, routine, "TICK")
    expect(s.gates.get("g-1")?.handoff).toBe("undelivered")
  })

  it("rejects an option key the gate does not offer, and leaves the gate open", async () => {
    const s = await setup()
    await raise(s.call)
    await expect(s.call("gate.answer", { gateId: "g-1", option: "z" })).rejects.toThrow(/BAD_OPTION.*a, b/)
    expect(s.gates.get("g-1")?.status).toBe("open")
    expect(s.delivered).toEqual([])
  })

  it("rejects an empty answer, a free-text gate's option key, and a second answer", async () => {
    const s = await setup()
    await raise(s.call, { options: [], recommended: undefined })
    await expect(s.call("gate.answer", { gateId: "g-1" })).rejects.toThrow(/option or text/)
    await expect(s.call("gate.answer", { gateId: "g-1", option: "a" })).rejects.toThrow(/BAD_OPTION.*free text/)
    await s.call("gate.answer", { gateId: "g-1", text: "yes" })
    await expect(s.call("gate.answer", { gateId: "g-1", text: "again" })).rejects.toThrow(/GATE_NOT_OPEN/)
    expect(s.delivered).toHaveLength(1)
    expect(s.delivered[0]?.text).toBe("[ROVE GATE g-1 answered] Ship the migration now?\nAnswer: yes")
  })

  it("validates a raise: recommended must be an option, keys unique, task must exist", async () => {
    const s = await setup()
    await expect(raise(s.call, { recommended: "q" })).rejects.toThrow(/recommended/)
    await expect(
      raise(s.call, {
        options: [
          { key: "a", label: "x" },
          { key: "a", label: "y" },
        ],
      }),
    ).rejects.toThrow(/duplicate/)
    await expect(raise(s.call, { question: "x".repeat(501) })).rejects.toThrow(/over 500/)
    await expect(raise(s.call, { taskId: "nope" })).rejects.toThrow(/task not found/)
    expect(await s.rows()).toEqual([])
  })

  it("withdraw closes an open gate; a closed gate cannot be withdrawn", async () => {
    const s = await setup()
    await raise(s.call)
    expect((await s.call("gate.withdraw", { gateId: "g-1" })).gate.status).toBe("withdrawn")
    expect(await s.rows()).toEqual([])
    await expect(s.call("gate.withdraw", { gateId: "g-1" })).rejects.toThrow(/GATE_NOT_OPEN/)
    await expect(s.call("gate.withdraw", { gateId: "g-9" })).rejects.toThrow(/GATE_NOT_FOUND/)
  })

  it("an answer owed to an engine that is away can be closed by the owner, and only until it is delivered", async () => {
    const s = await setup({ engine: "none" })
    await raise(s.call)
    await s.call("gate.answer", { gateId: "g-1", option: "a" })
    expect(await s.rows()).toHaveLength(1)
    expect((await s.call("gate.withdraw", { gateId: "g-1" })).gate.status).toBe("withdrawn")
    expect(await s.rows()).toEqual([])
    expect(s.gates.active()).toEqual([])
    expect((await s.call("gate.takeUndelivered", { taskId: TASK.id, tabId: "tab-2" })).text).toBeNull()

    const live = await setup()
    await raise(live.call)
    await live.call("gate.answer", { gateId: "g-1", option: "a" })
    await expect(live.call("gate.withdraw", { gateId: "g-1" })).rejects.toThrow(/GATE_NOT_OPEN.*delivered/)
  })

  it("deleting a task closes its answered-but-undelivered gates too", async () => {
    const s = await setup({ engine: "none" })
    await raise(s.call)
    await s.call("gate.answer", { gateId: "g-1", option: "a" })
    const ctx = {
      ...s.ctx,
      orch: { ...s.ctx.orch, prepareTaskDeletion: async () => true },
      issues: { unlinkTask: async () => null },
    } as unknown as DaemonHandlerContext
    await dispatchDaemonRequest(createDaemonHandlerRegistry(), "task.delete", { taskId: TASK.id }, ctx)
    expect(await s.rows()).toEqual([])
    expect((s.published.filter((p) => p.channel === "gates").at(-1)?.payload as { gates: Gate[] }).gates).toEqual([])
  })

  it("a raised gate remembers the delivery it reported blocked", async () => {
    const s = await setup()
    const armed = await s.deliveries.arm({ taskId: TASK.id, tabId: "tab-2", source: "send", promptHead: "tick" })
    const { gate } = await raise(s.call)
    expect(gate.deliveryId).toBe(armed.id)
    expect(s.gates.get("g-1")?.deliveryId).toBe(armed.id)
    expect((await raise(s.call)).gate.deliveryId).toBeUndefined()
  })

  it("two answers for one tab at once each reach the engine once", async () => {
    const s = await setup()
    await raise(s.call)
    await raise(s.call, { question: "Second?" })
    const runtime = s.ctx.runtime as unknown as Record<string, unknown>
    const land = runtime.deliverPromptToLiveEngineTabDetailed as (t: object, text: string) => Promise<unknown>
    const release = Promise.withResolvers<void>()
    runtime.deliverPromptToLiveEngineTabDetailed = async (t: object, text: string) => {
      await release.promise
      return land(t, text)
    }
    const answers = Promise.all([
      s.call("gate.answer", { gateId: "g-1", option: "a" }),
      s.call("gate.answer", { gateId: "g-2", option: "b" }),
    ])
    await vi.waitFor(() => expect(s.gates.undeliveredFor(TASK.id, "tab-2")).toHaveLength(2))
    release.resolve()
    await answers
    const pasted = s.delivered.map((d) => d.text).join("\n")
    expect(pasted.match(/GATE g-1 answered/g)).toHaveLength(1)
    expect(pasted.match(/GATE g-2 answered/g)).toHaveLength(1)
    expect(s.gates.active()).toEqual([])
  })

  it("deleting a task withdraws its open gates, and only its own", async () => {
    const s = await setup()
    await raise(s.call)
    await s.gates.raise({ taskId: "other", question: "keep me?" })
    await s.gates.withdrawTask(TASK.id)
    expect((await s.call("gate.list", { status: "all" })).gates.map((g) => [g.id, g.status])).toEqual([
      ["g-1", "withdrawn"],
      ["g-2", "open"],
    ])
  })

  it("the task.delete RPC withdraws too", async () => {
    const s = await setup()
    await raise(s.call)
    const ctx = {
      ...s.ctx,
      orch: { ...s.ctx.orch, prepareTaskDeletion: async () => true },
      issues: { unlinkTask: async () => null },
    } as unknown as DaemonHandlerContext
    await dispatchDaemonRequest(createDaemonHandlerRegistry(), "task.delete", { taskId: TASK.id }, ctx)
    expect(s.gates.get("g-1")?.status).toBe("withdrawn")
    expect(await s.rows()).toEqual([])
  })

  it("a restarted daemon replays its open gates in the first Inbox and gates pushes", async () => {
    const s = await setup()
    await raise(s.call)
    const bus = new DaemonEventBus()
    const published: Array<{ channel: string; payload: unknown }> = []
    bus.onPublish((e) => published.push({ channel: e.channel, payload: e.payload }))
    const inbox = new AttentionInboxStore(join(s.dir, "attention-inbox.json"), bus)
    const gates = new GatesStore(join(s.dir, "gates.json"))
    inbox.setProjection(() => gates.inboxItems())
    gates.setOnChange(() => {
      bus.publish("gates", { gates: gates.active() })
      inbox.publish()
    })
    await inbox.init()
    await gates.init()
    const latest = (channel: string) => [...published].reverse().find((p) => p.channel === channel)?.payload
    expect((latest("attention.inbox") as { items: AttentionInboxItem[] }).items.map((i) => i.state)).toEqual([
      "decision_needed",
    ])
    expect((latest("gates") as { gates: Gate[] }).gates.map((g) => g.id)).toEqual(["g-1"])
  })

  it("gate.list filters by task, status and repo", async () => {
    const s = await setup()
    await raise(s.call)
    await s.call("gate.answer", { gateId: "g-1", option: "a" })
    await raise(s.call)
    const ids = async (p: Record<string, unknown>) => (await s.call("gate.list", p)).gates.map((g) => g.id)
    expect(await ids({})).toEqual(["g-2"])
    expect(await ids({ status: "answered" })).toEqual(["g-1"])
    expect(await ids({ status: "all" })).toEqual(["g-1", "g-2"])
    expect(await ids({ taskId: "other", status: "all" })).toEqual([])
    expect(await ids({ repo: "/repo" })).toEqual(["g-2"])
    expect(await ids({ repo: "/elsewhere" })).toEqual([])
  })

  it("reloads from disk keeping ids monotonic", async () => {
    const s = await setup()
    await raise(s.call)
    await s.call("gate.withdraw", { gateId: "g-1" })
    const again = new GatesStore(join(s.dir, "gates.json"))
    await again.init()
    expect((await again.raise({ taskId: TASK.id, question: "next?" })).id).toBe("g-2")
  })

  it("refuses to overwrite a gates file it could not read", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rove-gates-"))
    dirs.push(dir)
    const path = join(dir, "gates.json")
    writeFileSync(path, '{"version":1,"gates":"oops"}')
    const gates = new GatesStore(path)
    await expect(gates.init()).rejects.toThrow(/unreadable/)
    await expect(gates.raise({ taskId: "t", question: "q" })).rejects.toThrow(/never loaded/)
    expect(readFileSync(path, "utf8")).toContain("oops")
  })

  it("prunes closed gates to the newest 200 but never an open or owed one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rove-gates-"))
    dirs.push(dir)
    const path = join(dir, "gates.json")
    const mk = (n: number, status: string, extra: Record<string, unknown> = {}) => ({
      id: `g-${n}`,
      taskId: "t",
      tabId: null,
      question: "q",
      options: [],
      status,
      createdAt: "2026-10-01T00:00:00.000Z",
      ...extra,
    })
    const closed = Array.from({ length: MAX_CLOSED_GATES + 20 }, (_, i) => mk(i + 3, "withdrawn"))
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        nextId: 400,
        // The oldest two are the ones that must survive: open, and answered-but-owed.
        gates: [
          mk(1, "open"),
          mk(2, "answered", { handoff: "undelivered", answer: { text: "x", by: "cli", at: "" } }),
          ...closed,
        ],
      }),
    )
    const gates = new GatesStore(path)
    await gates.init()
    await gates.raise({ taskId: "t", question: "trigger" })
    const kept = gates.list({ status: "all" })
    expect(kept.filter((g) => g.status === "withdrawn")).toHaveLength(MAX_CLOSED_GATES)
    expect(kept.find((g) => g.id === "g-1")?.status).toBe("open")
    expect(kept.find((g) => g.id === "g-2")?.handoff).toBe("undelivered")
    expect(kept.find((g) => g.id === "g-3")).toBeUndefined()
    expect(kept.some((g) => g.id === "g-400")).toBe(true)
  })
})
