import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ContextPayload } from "@sma1lboy/rove/src/cli/api/context-view.ts"
import { agentBrief, agentPrompt } from "../src/agent.ts"
import { REPLY_WINDOW_MS, type WeixinBridge, startWeixinBridge } from "../src/bridge.ts"
import type { RoveOps } from "../src/commands.ts"
import type { NotifyingRoutine } from "../src/routines.ts"
import { WeixinStore } from "../src/store.ts"
import { FAKE_BOT_ID, FAKE_OWNER, FAKE_TOKEN, FakeIlink, waitFor } from "./fake-ilink.ts"

type Row = ContextPayload["tasks"][number]

const TASK = "01TASKTASKTASKTASKTASK0042"

const GATE = {
  id: "g-5",
  taskId: TASK,
  tabId: null,
  question: "Which approach?",
  options: [
    { key: "a", label: "Rewrite" },
    { key: "b", label: "Patch" },
  ],
  status: "open" as const,
  createdAt: "2026-10-12T00:00:00.000Z",
}

function snapshot(group: Row["group"]): ContextPayload {
  return {
    repo: "*",
    at: "",
    tasks: [{ taskId: TASK, title: "Fix login", branch: "fix-login", group, rank: 0, activity: null }],
    attention: [],
    gates: [],
    notes: [],
  }
}

let fake: FakeIlink
let store: WeixinStore
let bridge: WeixinBridge | null
let current: ContextPayload
let routines: NotifyingRoutine[] = []
let clock: number
const logs: string[] = []

const status = mock(async () => current)
const send = mock(async () => ({ tab: "tab-1" }))
const add = mock(async () => ({ taskId: "01NEW" }))
const openAgentTask = mock(async () => ({ taskId: TASK }))
let nextTab = 1
let agentRunning = false
const newConversation = mock(async () => ({ tab: `tab-${nextTab++}` }))
const ops: RoveOps = {
  status,
  tasks: async () => [{ id: TASK, title: "Fix login", repo: "/r/app" }],
  repos: async () => ["/r/app"],
  send,
  add,
  gates: async () => [],
  answerGate: async () => ({ delivered: true }),
  clearReport: async () => {},
  notifyingRoutineRuns: async () => routines,
  openAgentTask,
  newConversation,
  taskRunning: async () => agentRunning,
}

function start(onUnbound?: () => void): WeixinBridge {
  bridge = startWeixinBridge({
    store,
    ops,
    log: (_event, message) => logs.push(message),
    notifyTickMs: 40,
    pollTimeoutMs: 2_000,
    typingTimings: { keepaliveMs: 20, warmupMs: 200, maxMs: 5_000 },
    now: () => clock,
    ...(onUnbound ? { onUnbound } : {}),
  })
  return bridge
}

beforeEach(async () => {
  fake = await new FakeIlink().start()
  store = new WeixinStore(mkdtempSync(join(tmpdir(), "weixin-bridge-")))
  store.writeAccount({
    accountId: FAKE_BOT_ID,
    token: FAKE_TOKEN,
    baseUrl: fake.url,
    ownerUserId: FAKE_OWNER,
    allow: [],
    savedAt: "",
  })
  current = snapshot("working")
  routines = []
  clock = Date.now()
  logs.length = 0
  bridge = null
  for (const fn of [status, send, add, openAgentTask, newConversation]) fn.mockClear()
  nextTab = 1
  agentRunning = false
})

afterEach(async () => {
  bridge?.stop()
  await fake.stop()
})

describe("inbound", () => {
  it("answers the owner with the status, echoing that message's context token", async () => {
    current = snapshot("waiting-on-you")
    start()
    fake.deliver({ from: FAKE_OWNER, text: "/status", contextToken: "ctx-owner-1" })
    const [reply] = await fake.waitForSends(1)
    expect(reply).toMatchObject({ to: FAKE_OWNER, contextToken: "ctx-owner-1" })
    expect(reply?.text.split("\n")[0]).toBe("1 need you · 0 running")
    await waitFor(() => expect(store.readState(FAKE_BOT_ID).syncBuf).toBe("buf-1"))
    expect(store.readState(FAKE_BOT_ID).peers[FAKE_OWNER]).toEqual({
      contextToken: "ctx-owner-1",
      lastInboundAt: clock,
    })
  })

  it("drops strangers silently but remembers them for `weixin status`", async () => {
    start()
    fake.deliver({ from: "stranger@im.wechat", text: "/status" })
    fake.deliver({ from: FAKE_OWNER, text: "/help" })
    await fake.waitForSends(1)
    expect(fake.sends.map((s) => s.to)).toEqual([FAKE_OWNER])
    expect(store.readState(FAKE_BOT_ID).rejected.map((r) => r.userId)).toEqual(["stranger@im.wechat"])
  })

  it("lets allow-listed users in and answers a redelivered message once", async () => {
    store.writeAccount({ ...(store.readAccount() ?? fail()), allow: ["friend@im.wechat"] })
    start()
    fake.deliver({ from: "friend@im.wechat", text: "/help", id: "dup-1" })
    fake.deliver({ from: "friend@im.wechat", text: "/help", id: "dup-1" })
    fake.deliver({ from: FAKE_OWNER, text: "/help", id: "after" })
    await fake.waitForSends(2)
    expect(fake.sends.map((s) => s.to)).toEqual(["friend@im.wechat", FAKE_OWNER])
  })

  it("re-sends once without the context token when iLink calls it stale", async () => {
    fake.sendAnswers.push({ ret: -14, errmsg: "session timeout" })
    start()
    fake.deliver({ from: FAKE_OWNER, text: "/help", contextToken: "stale" })
    const sends = await fake.waitForSends(2)
    expect(sends.map((s) => s.contextToken)).toEqual(["stale", undefined])
    expect(store.readUndelivered()).toEqual([])
  })

  it("shows the owner the agent typing while its task runs, and clears it when the turn ends", async () => {
    start()
    agentRunning = true
    fake.deliver({ from: FAKE_OWNER, text: "查一下昨晚的 CI" })
    await waitFor(() => expect(fake.typing.filter((t) => t.on).length).toBeGreaterThan(2))
    expect(fake.typing[0]).toEqual({ to: FAKE_OWNER, ticket: `ticket-${FAKE_OWNER}`, on: true })
    expect(fake.typing.some((t) => !t.on)).toBe(false)

    agentRunning = false
    await waitFor(() => expect(fake.typing.at(-1)?.on).toBe(false))
    const settled = fake.typing.length
    await new Promise((r) => setTimeout(r, 100))
    expect(fake.typing).toHaveLength(settled)
    // Commands answer at once and never show the agent typing.
    fake.deliver({ from: FAKE_OWNER, text: "/status" })
    await fake.waitForSends(1)
    expect(fake.typing).toHaveLength(settled)
  })

  it("plain text opens the WeChat agent's project once, then talks to its live conversation; /new starts another", async () => {
    start()
    fake.deliver({ from: FAKE_OWNER, text: "帮我看看昨天的 PR", id: "m1" })
    await waitFor(() => expect(newConversation).toHaveBeenCalledTimes(1))
    expect(openAgentTask).toHaveBeenCalledWith(join(store.dir, "agent"), "WeChat")
    expect(newConversation).toHaveBeenCalledWith(TASK, `${agentBrief("rove")}\n\n${agentPrompt("帮我看看昨天的 PR")}`)

    fake.deliver({ from: FAKE_OWNER, text: "status 呢", id: "m2" })
    await waitFor(() => expect(send).toHaveBeenCalledWith(TASK, "tab-1", agentPrompt("status 呢")))

    fake.deliver({ from: FAKE_OWNER, text: "/new", id: "m3" })
    fake.deliver({ from: FAKE_OWNER, text: "/status", id: "m4" })
    const sends = await fake.waitForSends(2)
    expect(sends.map((s) => s.text.split("\n")[0])).toEqual([
      "New conversation (#2). Earlier ones stay in Rove's WeChat project.",
      "Nothing needs you. 1 running",
    ])
    expect(openAgentTask).toHaveBeenCalledTimes(1)
    expect(store.readState(FAKE_BOT_ID).agent).toMatchObject({
      taskId: TASK,
      tab: "tab-2",
      conversations: [{ tab: "tab-1" }, { tab: "tab-2" }],
    })
  })

  it("routes `send` to the task's engine through RoveOps", async () => {
    start()
    fake.deliver({ from: FAKE_OWNER, text: "/send 0042 please rebase" })
    const [reply] = await fake.waitForSends(1)
    expect(ops.send).toHaveBeenCalledWith(TASK, undefined, "please rebase")
    expect(reply?.text).toBe("Sent to SK0042 Fix login (tab-1).")
  })
})

describe("pushes", () => {
  it("pushes a settled arrival into needs-you, but never the state seen at boot", async () => {
    current = snapshot("ready-for-review")
    start()
    // Open the reply window, then let a few ticks pass on the boot state.
    fake.deliver({ from: FAKE_OWNER, text: "/help" })
    await fake.waitForSends(1)
    await waitFor(() => expect(status.mock.calls.length).toBeGreaterThan(3))
    expect(fake.sends).toHaveLength(1)

    current = snapshot("waiting-on-you")
    const sends = await fake.waitForSends(2)
    expect(sends[1]?.text).toBe("Needs you:\n• SK0042 Fix login\nReply: send SK0042 <text>")
  })

  it("pushes a decision that opens after boot with its option keys, never one already standing", async () => {
    current = { ...snapshot("working"), gates: [GATE] }
    start()
    fake.deliver({ from: FAKE_OWNER, text: "/help" })
    await fake.waitForSends(1)
    await waitFor(() => expect(status.mock.calls.length).toBeGreaterThan(3))
    expect(fake.sends).toHaveLength(1)

    current = { ...snapshot("working"), gates: [GATE, { ...GATE, id: "g-6", question: "Ship it?", options: [] }] }
    const sends = await fake.waitForSends(2)
    expect(sends[1]?.text).toBe(
      "Decision needed:\ng-6 SK0042 Fix login\nShip it?\n  free text only\nReply: answer g-6 <text>",
    )
    // Announced once, not on every tick.
    await waitFor(() => expect(status.mock.calls.length).toBeGreaterThan(8))
    expect(fake.sends).toHaveLength(2)
  })

  it("pushes a --notify routine's new response and failure, never runs from before boot", async () => {
    const run = (n: number, extra: Record<string, unknown>) => ({
      id: `run-${n}`,
      automationId: "r1",
      runNumber: n,
      scheduledFor: "2026-10-22T00:00:00.000Z",
      trigger: "scheduled" as const,
      at: "2026-10-22T00:00:00.000Z",
      status: "ran" as const,
      ...extra,
    })
    routines = [{ id: "r1", name: "janitor", runs: [run(1, { response: { text: "old news", at: "" } })] }]
    start()
    fake.deliver({ from: FAKE_OWNER, text: "/help" })
    await fake.waitForSends(1)
    await waitFor(() => expect(status.mock.calls.length).toBeGreaterThan(2))

    routines = [
      {
        id: "r1",
        name: "janitor",
        runs: [
          run(3, { status: "script_failed", error: "script exited 2" }),
          run(2, { response: { text: "removed 3 worktrees", at: "" } }),
          ...(routines[0]?.runs ?? []),
        ],
      },
    ]
    const sends = await fake.waitForSends(3)
    expect(sends.slice(1).map((s) => s.text)).toEqual([
      "[janitor] #2\nremoved 3 worktrees",
      "[janitor] #3 script failed\nscript exited 2",
    ])
    await waitFor(() => expect(status.mock.calls.length).toBeGreaterThan(8))
    expect(fake.sends).toHaveLength(3)
  })

  it("logs instead of sending once the peer's reply window has closed", async () => {
    start()
    fake.deliver({ from: FAKE_OWNER, text: "/help" })
    await fake.waitForSends(1)
    await waitFor(() => expect(status.mock.calls.length).toBeGreaterThan(1))

    clock += REPLY_WINDOW_MS + 1
    current = snapshot("landing")
    await waitFor(() => expect(store.readUndelivered()).toHaveLength(1))
    expect(store.readUndelivered()[0]).toMatchObject({
      to: FAKE_OWNER,
      reason: "reply window closed (>24h since their last message)",
      text: "Ready to merge:\n• SK0042 Fix login",
    })
    expect(fake.sends).toHaveLength(1)
  })
})

it("releases the daemon's keep-alive when the binding is removed", async () => {
  const onUnbound = mock(() => {})
  const b = start(onUnbound)
  expect(b.isBound()).toBe(true)
  await waitFor(() => expect(fake.polls.length).toBeGreaterThan(0))
  store.clearAccount()
  await waitFor(() => expect(onUnbound).toHaveBeenCalledTimes(1))
  expect(b.isBound()).toBe(false)
})

function fail(): never {
  throw new Error("account missing")
}
