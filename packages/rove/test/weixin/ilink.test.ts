import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { IlinkClient, classifyIlink, messageText } from "../../src/weixin/ilink.ts"
import { runQrLogin } from "../../src/weixin/login.ts"
import { WeixinStore } from "../../src/weixin/store.ts"
import { FAKE_BOT_ID, FAKE_OWNER, FAKE_TOKEN, FakeIlink } from "./fake-ilink.ts"

let fake: FakeIlink

beforeEach(async () => {
  fake = await new FakeIlink().start()
})

afterEach(async () => {
  await fake.stop()
})

describe("iLink wire format", () => {
  it("authenticates, echoes the context token and wraps text as a finished bot message", async () => {
    const client = new IlinkClient(fake.url, FAKE_TOKEN)
    await client.sendText("peer@im.wechat", "hello", "ctx-1")
    await client.sendText("peer@im.wechat", "no token", null)
    expect(fake.sends).toEqual([
      { to: "peer@im.wechat", text: "hello", contextToken: "ctx-1", authorization: `Bearer ${FAKE_TOKEN}` },
      { to: "peer@im.wechat", text: "no token", authorization: `Bearer ${FAKE_TOKEN}` },
    ])
  })

  it("long-polls with the cursor and returns queued messages with the next cursor", async () => {
    const client = new IlinkClient(fake.url, FAKE_TOKEN)
    fake.deliver({ from: FAKE_OWNER, text: "status" })
    const resp = await client.getUpdates("buf-0", 2_000)
    expect(fake.polls[0]?.buf).toBe("buf-0")
    expect(resp.get_updates_buf).toBe("buf-1")
    expect(resp.msgs?.map(messageText)).toEqual(["status"])
  })

  it("treats a client-side long-poll timeout as an empty answer that keeps the cursor", async () => {
    fake.holdMs = 10_000
    const client = new IlinkClient(fake.url, FAKE_TOKEN)
    const started = Date.now()
    const resp = await client.getUpdates("buf-7", 100)
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(resp).toEqual({ ret: 0, msgs: [], get_updates_buf: "buf-7" })
  })

  it("never puts a response body in an HTTP error", async () => {
    const client = new IlinkClient(`${fake.url}/missing`, FAKE_TOKEN)
    await expect(client.sendText("x", "y", null)).rejects.toThrow(/^iLink HTTP 404$/)
  })
})

describe("classifyIlink", () => {
  it.each([
    [{ ret: 0 }, "ok"],
    [{}, "ok"],
    [{ ret: -14 }, "session-expired"],
    [{ errcode: -14 }, "session-expired"],
    // -2 is a rate limit unless iLink's text says the session is stale.
    [{ ret: -2, errmsg: "unknown error" }, "session-expired"],
    [{ errcode: -2, errmsg: "prepare failed" }, "session-expired"],
    [{ ret: -2, errmsg: "frequency limit" }, "rate-limited"],
    [{ ret: 1, errmsg: "bad" }, "error"],
  ])("%j → %s", (resp, outcome) => {
    expect(classifyIlink(resp)).toBe(outcome)
  })
})

describe("messageText", () => {
  it("prefers typed text and falls back to WeChat's voice transcript", () => {
    expect(messageText({ item_list: [{ type: 3, voice_item: { text: " 状态 " } }] })).toBe("状态")
    expect(
      messageText({
        item_list: [
          { type: 3, voice_item: { text: "spoken" } },
          { type: 1, text_item: { text: "typed" } },
        ],
      }),
    ).toBe("typed")
    expect(messageText({ item_list: [{ type: 2 }] })).toBe("")
  })
})

describe("QR login", () => {
  function io() {
    let clock = 0
    const said: string[] = []
    const qrs: string[] = []
    return {
      said,
      qrs,
      io: {
        showQr: (url: string) => qrs.push(url),
        say: (line: string) => said.push(line),
        sleep: async (ms: number) => {
          clock += ms
        },
        now: () => clock,
      },
    }
  }

  it("waits through scan → confirm and stores the owner and the confirmed base URL", async () => {
    const store = new WeixinStore(mkdtempSync(join(tmpdir(), "weixin-login-")))
    fake.qrStatuses.splice(
      0,
      fake.qrStatuses.length,
      { status: "wait" },
      { status: "scaned" },
      { status: "scaned" },
      {
        status: "confirmed",
        ilink_bot_id: FAKE_BOT_ID,
        bot_token: FAKE_TOKEN,
        baseurl: `${fake.url}/`,
        ilink_user_id: FAKE_OWNER,
      },
    )
    const t = io()
    const result = await runQrLogin(store, fake.url, t.io)
    expect(t.said.filter((line) => line.startsWith("Scanned"))).toHaveLength(1)
    expect(result.ok).toBe(true)
    expect(store.readAccount()).toMatchObject({
      accountId: FAKE_BOT_ID,
      token: FAKE_TOKEN,
      baseUrl: fake.url,
      ownerUserId: FAKE_OWNER,
      allow: [],
    })
  })

  it("re-issues an expired QR a bounded number of times", async () => {
    const store = new WeixinStore(mkdtempSync(join(tmpdir(), "weixin-login-")))
    fake.qrStatuses.splice(0, fake.qrStatuses.length, { status: "expired" })
    const t = io()
    const result = await runQrLogin(store, fake.url, t.io)
    expect(result).toEqual({ ok: false, reason: "the QR code expired too many times" })
    expect(t.qrs).toHaveLength(4)
    expect(store.readAccount()).toBeNull()
  })
})
