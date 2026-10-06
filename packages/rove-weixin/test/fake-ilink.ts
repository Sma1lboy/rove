/**
 * A local stand-in for Tencent's iLink Bot API, over real HTTP. Response
 * shapes mirror the official client's wire format; every id and token here is
 * invented. Used by the bridge tests and the sandbox end-to-end demo
 * (`bun test/weixin/fake-ilink.ts`).
 */

import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http"
import type { AddressInfo } from "node:net"

export const FAKE_BOT_ID = "fakebot0001@im.bot"
export const FAKE_TOKEN = "fake-token-not-a-secret"
export const FAKE_OWNER = "owner-user-0001@im.wechat"

export interface RecordedSend {
  readonly to: string
  readonly text: string
  readonly contextToken?: string
  readonly authorization?: string
}

export interface InboundSpec {
  readonly from: string
  readonly text: string
  readonly id?: string
  readonly contextToken?: string
}

type Answer = Record<string, unknown>

/**
 * Retry `check` until it stops throwing — the bridge runs on its own loops, so
 * tests wait on the observable outcome, not a guessed delay.
 */
export async function waitFor(check: () => void, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      check()
      return
    } catch (err) {
      if (Date.now() > deadline) throw err
      await Bun.sleep(20)
    }
  }
}

export class FakeIlink {
  readonly sends: RecordedSend[] = []
  /** `getupdates` request bodies, in order. */
  readonly polls: Array<{ readonly buf: string; readonly authorization?: string }> = []
  /** Answers for the next `sendmessage` calls; default `{ret: 0}`. */
  readonly sendAnswers: Answer[] = []
  /** Status answers for `get_qrcode_status`; the last one repeats. */
  readonly qrStatuses: Answer[] = [{ status: "wait" }]
  /** How long an empty long poll is held, like the real server. */
  holdMs = 150
  private inbox: Answer[] = []
  private cursor = 0
  private waiters: Array<() => void> = []
  private qrCount = 0
  private server: Server | null = null
  url = ""

  async start(port = 0): Promise<this> {
    this.server = createServer((req, res) => void this.handle(req, res))
    await new Promise<void>((resolve) => this.server?.listen(port, "127.0.0.1", resolve))
    const { port: bound } = this.server.address() as AddressInfo
    this.url = `http://127.0.0.1:${bound}`
    return this
  }

  async stop(): Promise<void> {
    for (const wake of this.waiters.splice(0)) wake()
    this.server?.closeAllConnections()
    await new Promise<void>((resolve) => this.server?.close(() => resolve()))
  }

  /** Queue a message from a WeChat user; the next long poll returns it. */
  deliver(spec: InboundSpec): void {
    this.inbox.push({
      message_id: spec.id ?? `m${this.cursor + this.inbox.length + 1}`,
      from_user_id: spec.from,
      to_user_id: FAKE_BOT_ID,
      message_type: 1,
      context_token: spec.contextToken ?? `ctx-${spec.from}-${this.cursor + this.inbox.length + 1}`,
      item_list: [{ type: 1, text_item: { text: spec.text } }],
    })
    for (const wake of this.waiters.splice(0)) wake()
  }

  /** Resolves once `count` sends have been recorded. */
  async waitForSends(count: number): Promise<RecordedSend[]> {
    await waitFor(() => {
      if (this.sends.length < count) throw new Error(`expected ${count} sends, saw ${this.sends.length}`)
    })
    return this.sends
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", this.url)
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const body = chunks.length > 0 ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as Answer) : {}
    const auth = req.headers.authorization
    const reply = (answer: Answer, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json" })
      res.end(JSON.stringify(answer))
    }

    switch (url.pathname) {
      case "/ilink/bot/get_bot_qrcode":
        this.qrCount++
        return reply({ qrcode: `qr-${this.qrCount}`, qrcode_img_content: `${this.url}/scan/qr-${this.qrCount}` })
      case "/ilink/bot/get_qrcode_status": {
        const next = this.qrStatuses.length > 1 ? this.qrStatuses.shift() : this.qrStatuses[0]
        return reply(next ?? { status: "wait" })
      }
      case "/ilink/bot/getupdates": {
        if (auth !== `Bearer ${FAKE_TOKEN}`) return reply({ ret: -14, errmsg: "session expired" })
        this.polls.push({ buf: String(body.get_updates_buf ?? ""), authorization: auth })
        if (this.inbox.length === 0) {
          await new Promise<void>((resolve) => {
            this.waiters.push(resolve)
            setTimeout(resolve, this.holdMs)
          })
        }
        const msgs = this.inbox.splice(0)
        this.cursor += msgs.length
        return reply({ ret: 0, msgs, get_updates_buf: `buf-${this.cursor}` })
      }
      case "/ilink/bot/sendmessage": {
        const msg = (body.msg ?? {}) as {
          to_user_id?: string
          context_token?: string
          item_list?: Array<{ text_item?: { text?: string } }>
        }
        this.sends.push({
          to: msg.to_user_id ?? "",
          text: msg.item_list?.[0]?.text_item?.text ?? "",
          ...(msg.context_token ? { contextToken: msg.context_token } : {}),
          ...(auth ? { authorization: auth } : {}),
        })
        return reply(this.sendAnswers.shift() ?? { ret: 0 })
      }
      // Demo controls, not iLink endpoints.
      case "/_inject":
        this.deliver({ from: String(body.from ?? FAKE_OWNER), text: String(body.text ?? "") })
        return reply({ ok: true })
      case "/_sends":
        return reply({ sends: this.sends })
      default:
        return reply({ error: "not found" }, 404)
    }
  }
}

// Standalone: a fake that confirms any login as FAKE_OWNER, for sandbox demos.
if (import.meta.main) {
  const fake = await new FakeIlink().start(Number(process.env.PORT ?? 0))
  fake.qrStatuses.splice(
    0,
    fake.qrStatuses.length,
    { status: "scaned" },
    {
      status: "confirmed",
      ilink_bot_id: FAKE_BOT_ID,
      bot_token: FAKE_TOKEN,
      baseurl: fake.url,
      ilink_user_id: FAKE_OWNER,
    },
  )
  console.log(`fake iLink listening on ${fake.url}`)
  console.log("POST /_inject {from,text} to queue an inbound message; GET /_sends lists replies")
}
