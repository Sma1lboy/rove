import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ContextPayload } from "../../src/cli/api/context-view.ts"
import { REPLY_WINDOW_MS, type WeixinBridge, startWeixinBridge } from "../../src/weixin/bridge.ts"
import type { RoveOps } from "../../src/weixin/commands.ts"
import { WeixinStore } from "../../src/weixin/store.ts"
import { FAKE_BOT_ID, FAKE_OWNER, FAKE_TOKEN, FakeIlink } from "./fake-ilink.ts"

type Row = ContextPayload["tasks"][number]

const TASK = "01TASKTASKTASKTASKTASK0042"

function snapshot(group: Row["group"]): ContextPayload {
  return {
    repo: "*",
    at: "",
    tasks: [{ taskId: TASK, title: "Fix login", branch: "fix-login", group, rank: 0, activity: null }],
    attention: [],
    notes: [],
  }
}

let fake: FakeIlink
let store: WeixinStore
let bridge: WeixinBridge | null
let current: ContextPayload
let clock: number
const logs: string[] = []

const ops: RoveOps = {
  status: vi.fn(async () => current),
  tasks: async () => [{ id: TASK, title: "Fix login", repo: "/r/app" }],
  repos: async () => ["/r/app"],
  send: vi.fn(async () => ({ tab: "tab-1" })),
  add: vi.fn(async () => ({ taskId: "01NEW" })),
}

function start(onUnbound?: () => void): WeixinBridge {
  bridge = startWeixinBridge({
    store,
    ops,
    log: (_event, message) => logs.push(message),
    notifyTickMs: 40,
    pollTimeoutMs: 2_000,
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
  clock = Date.now()
  logs.length = 0
  bridge = null
  vi.clearAllMocks()
})

afterEach(async () => {
  bridge?.stop()
  await fake.stop()
})

describe("inbound", () => {
  it("answers the owner with the status, echoing that message's context token", async () => {
    current = snapshot("waiting-on-you")
    start()
    fake.deliver({ from: FAKE_OWNER, text: "status", contextToken: "ctx-owner-1" })
    const [reply] = await fake.waitForSends(1)
    expect(reply).toMatchObject({ to: FAKE_OWNER, contextToken: "ctx-owner-1" })
    expect(reply?.text.split("\n")[0]).toBe("1 need you · 0 running")
    await vi.waitFor(() => expect(store.readState(FAKE_BOT_ID).syncBuf).toBe("buf-1"))
    expect(store.readState(FAKE_BOT_ID).peers[FAKE_OWNER]).toEqual({
      contextToken: "ctx-owner-1",
      lastInboundAt: clock,
    })
  })

  it("drops strangers silently but remembers them for `weixin status`", async () => {
    start()
    fake.deliver({ from: "stranger@im.wechat", text: "status" })
    fake.deliver({ from: FAKE_OWNER, text: "help" })
    await fake.waitForSends(1)
    expect(fake.sends.map((s) => s.to)).toEqual([FAKE_OWNER])
    expect(store.readState(FAKE_BOT_ID).rejected.map((r) => r.userId)).toEqual(["stranger@im.wechat"])
  })

  it("lets allow-listed users in and answers a redelivered message once", async () => {
    store.writeAccount({ ...(store.readAccount() ?? fail()), allow: ["friend@im.wechat"] })
    start()
    fake.deliver({ from: "friend@im.wechat", text: "help", id: "dup-1" })
    fake.deliver({ from: "friend@im.wechat", text: "help", id: "dup-1" })
    fake.deliver({ from: FAKE_OWNER, text: "help", id: "after" })
    await fake.waitForSends(2)
    expect(fake.sends.map((s) => s.to)).toEqual(["friend@im.wechat", FAKE_OWNER])
  })

  it("re-sends once without the context token when iLink calls it stale", async () => {
    fake.sendAnswers.push({ ret: -14, errmsg: "session timeout" })
    start()
    fake.deliver({ from: FAKE_OWNER, text: "help", contextToken: "stale" })
    const sends = await fake.waitForSends(2)
    expect(sends.map((s) => s.contextToken)).toEqual(["stale", undefined])
    expect(store.readUndelivered()).toEqual([])
  })

  it("routes `send` to the task's engine through RoveOps", async () => {
    start()
    fake.deliver({ from: FAKE_OWNER, text: "send 0042 please rebase" })
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
    fake.deliver({ from: FAKE_OWNER, text: "help" })
    await fake.waitForSends(1)
    await vi.waitFor(() => expect(vi.mocked(ops.status).mock.calls.length).toBeGreaterThan(3))
    expect(fake.sends).toHaveLength(1)

    current = snapshot("waiting-on-you")
    const sends = await fake.waitForSends(2)
    expect(sends[1]?.text).toBe("Needs you:\n• SK0042 Fix login\nReply: send SK0042 <text>")
  })

  it("logs instead of sending once the peer's reply window has closed", async () => {
    start()
    fake.deliver({ from: FAKE_OWNER, text: "help" })
    await fake.waitForSends(1)
    await vi.waitFor(() => expect(vi.mocked(ops.status).mock.calls.length).toBeGreaterThan(1))

    clock += REPLY_WINDOW_MS + 1
    current = snapshot("landing")
    await vi.waitFor(() => expect(store.readUndelivered()).toHaveLength(1))
    expect(store.readUndelivered()[0]).toMatchObject({
      to: FAKE_OWNER,
      reason: "reply window closed (>24h since their last message)",
      text: "Ready to merge:\n• SK0042 Fix login",
    })
    expect(fake.sends).toHaveLength(1)
  })
})

it("releases the daemon's keep-alive when the binding is removed", async () => {
  const onUnbound = vi.fn()
  const b = start(onUnbound)
  expect(b.isBound()).toBe(true)
  await vi.waitFor(() => expect(fake.polls.length).toBeGreaterThan(0))
  store.clearAccount()
  await vi.waitFor(() => expect(onUnbound).toHaveBeenCalledTimes(1), { timeout: 5_000 })
  expect(b.isBound()).toBe(false)
})

function fail(): never {
  throw new Error("account missing")
}
