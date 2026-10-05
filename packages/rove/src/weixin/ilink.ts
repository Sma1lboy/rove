/**
 * Tencent iLink Bot API — the transport behind a personal WeChat (微信) bot.
 * Plain JSON over HTTPS: QR login, a `getupdates` long poll for inbound, and
 * `sendmessage` for outbound. Every reply echoes the peer's latest
 * `context_token`; without one iLink only accepts a degraded tokenless send.
 *
 * Text only on purpose: media rides an AES-encrypted CDN Rove has no use for.
 * `fetch` is injected so tests replay recorded responses without a network.
 */

import { randomBytes, randomUUID } from "node:crypto"
import { readRoveEnv } from "@sma1lboy/rove-daemon/compat-env"

export const ILINK_BASE_URL = "https://ilinkai.weixin.qq.com"

const APP_ID = "bot"
const CHANNEL_VERSION = "2.2.0"
const APP_CLIENT_VERSION = String((2 << 16) | (2 << 8) | 0)
/** `bot_type` of the QR that binds a personal-account bot. */
const BOT_TYPE = "3"

export const LONG_POLL_TIMEOUT_MS = 35_000
const API_TIMEOUT_MS = 15_000

const ITEM_TEXT = 1
const ITEM_VOICE = 3
const MSG_TYPE_BOT = 2
const MSG_STATE_FINISH = 2

const SESSION_EXPIRED = -14
const RATE_LIMITED = -2

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>

/** `ROVE_WEIXIN_BASE_URL` points QR login at another endpoint (a fake server in tests and sandbox demos). */
export function resolveIlinkBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (readRoveEnv("WEIXIN_BASE_URL", env) ?? ILINK_BASE_URL).replace(/\/+$/, "")
}

interface IlinkItem {
  readonly type?: number
  readonly text_item?: { readonly text?: string }
  readonly voice_item?: { readonly text?: string }
}

export interface IlinkMessage {
  readonly message_id?: string | number
  readonly from_user_id?: string
  readonly to_user_id?: string
  readonly context_token?: string
  readonly item_list?: readonly IlinkItem[]
  readonly room_id?: string
  readonly chat_room_id?: string
}

export interface IlinkStatus {
  readonly ret?: number
  readonly errcode?: number
  readonly errmsg?: string
  readonly msg?: string
}

export interface UpdatesResponse extends IlinkStatus {
  readonly msgs?: readonly IlinkMessage[]
  readonly get_updates_buf?: string
  readonly longpolling_timeout_ms?: number
}

/**
 * How iLink answered. `session-expired` (-14, or -2 with iLink's
 * "unknown error"/"prepare failed" text) means the context token is stale or
 * iLink will not open a bot-initiated send until the peer messages the bot
 * again; a real -2 is a rate limit.
 */
export type IlinkOutcome = "ok" | "session-expired" | "rate-limited" | "error"

export function classifyIlink(resp: IlinkStatus): IlinkOutcome {
  const ret = resp.ret ?? 0
  const errcode = resp.errcode ?? 0
  if (ret === 0 && errcode === 0) return "ok"
  if (ret === SESSION_EXPIRED || errcode === SESSION_EXPIRED) return "session-expired"
  if (ret === RATE_LIMITED || errcode === RATE_LIMITED) {
    const msg = (resp.errmsg ?? resp.msg ?? "").toLowerCase()
    return msg === "unknown error" || msg === "prepare failed" ? "session-expired" : "rate-limited"
  }
  return "error"
}

/** One-line error description — codes and iLink's message only, never the body. */
export function describeIlink(resp: IlinkStatus): string {
  return `ret=${resp.ret ?? 0} errcode=${resp.errcode ?? 0}${resp.errmsg || resp.msg ? ` (${resp.errmsg ?? resp.msg})` : ""}`
}

/** The text a person typed; voice notes fall back to WeChat's transcript. */
export function messageText(message: IlinkMessage): string {
  const items = message.item_list ?? []
  for (const item of items) if (item.type === ITEM_TEXT) return (item.text_item?.text ?? "").trim()
  for (const item of items) if (item.type === ITEM_VOICE && item.voice_item?.text) return item.voice_item.text.trim()
  return ""
}

/** Group events are out of scope: a QR-bound bot identity rarely receives them. */
export function isGroupMessage(message: IlinkMessage): boolean {
  return Boolean(message.room_id || message.chat_room_id)
}

async function requestJson<T>(fetchFn: FetchFn, url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  const raw = await res.text()
  // The body may echo the bot token; only the status leaves this function.
  if (!res.ok) throw new Error(`iLink HTTP ${res.status}`)
  return JSON.parse(raw) as T
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")
}

export interface LoginQr {
  /** Opaque id the status poll takes. */
  readonly qrcode: string
  /** The URL WeChat must scan (not the bare id). */
  readonly url: string
}

export type LoginStatus =
  | { readonly status: "wait" | "scaned" | "expired" }
  | { readonly status: "redirect"; readonly baseUrl: string }
  | {
      readonly status: "confirmed"
      readonly accountId: string
      readonly token: string
      readonly baseUrl: string
      /** The WeChat user who scanned — the owner the bot answers by default. */
      readonly userId: string
    }

function loginHeaders(): Record<string, string> {
  return { "iLink-App-Id": APP_ID, "iLink-App-ClientVersion": APP_CLIENT_VERSION }
}

export async function fetchLoginQr(baseUrl: string, fetchFn: FetchFn = fetch): Promise<LoginQr> {
  const resp = await requestJson<{ qrcode?: string; qrcode_img_content?: string }>(
    fetchFn,
    `${baseUrl}/ilink/bot/get_bot_qrcode?bot_type=${BOT_TYPE}`,
    { method: "GET", headers: loginHeaders() },
    LONG_POLL_TIMEOUT_MS,
  )
  if (!resp.qrcode) throw new Error("iLink returned no QR code")
  return { qrcode: resp.qrcode, url: resp.qrcode_img_content || resp.qrcode }
}

export async function pollLoginStatus(baseUrl: string, qrcode: string, fetchFn: FetchFn = fetch): Promise<LoginStatus> {
  let resp: {
    status?: string
    redirect_host?: string
    ilink_bot_id?: string
    bot_token?: string
    baseurl?: string
    ilink_user_id?: string
  }
  try {
    resp = await requestJson(
      fetchFn,
      `${baseUrl}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
      { method: "GET", headers: loginHeaders() },
      LONG_POLL_TIMEOUT_MS,
    )
  } catch (err) {
    if (isTimeout(err)) return { status: "wait" }
    throw err
  }
  switch (resp.status) {
    case "scaned":
    case "expired":
      return { status: resp.status }
    case "scaned_but_redirect":
      return resp.redirect_host
        ? { status: "redirect", baseUrl: `https://${resp.redirect_host}` }
        : { status: "scaned" }
    case "confirmed":
      if (!resp.ilink_bot_id || !resp.bot_token) throw new Error("iLink confirmed the login without credentials")
      return {
        status: "confirmed",
        accountId: resp.ilink_bot_id,
        token: resp.bot_token,
        baseUrl: (resp.baseurl || baseUrl).replace(/\/+$/, ""),
        userId: resp.ilink_user_id ?? "",
      }
    default:
      return { status: "wait" }
  }
}

/** An authenticated bot session: inbound long poll plus text replies. */
export class IlinkClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  private post<T>(endpoint: string, payload: Record<string, unknown>, timeoutMs: number): Promise<T> {
    const body = JSON.stringify({ ...payload, base_info: { channel_version: CHANNEL_VERSION } })
    return requestJson<T>(
      this.fetchFn,
      `${this.baseUrl}/${endpoint}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          AuthorizationType: "ilink_bot_token",
          Authorization: `Bearer ${this.token}`,
          // A random uin per request, as the official client sends.
          "X-WECHAT-UIN": Buffer.from(String(randomBytes(4).readUInt32BE(0))).toString("base64"),
          ...loginHeaders(),
        },
        body,
      },
      timeoutMs,
    )
  }

  /** One long poll. The server holds it until messages arrive; a client-side
   *  timeout is the normal empty answer, not an error. */
  async getUpdates(syncBuf: string, timeoutMs: number = LONG_POLL_TIMEOUT_MS): Promise<UpdatesResponse> {
    try {
      return await this.post<UpdatesResponse>("ilink/bot/getupdates", { get_updates_buf: syncBuf }, timeoutMs)
    } catch (err) {
      if (isTimeout(err)) return { ret: 0, msgs: [], get_updates_buf: syncBuf }
      throw err
    }
  }

  /** Send one text bubble. Returns iLink's status object; callers classify it. */
  sendText(to: string, text: string, contextToken: string | null): Promise<IlinkStatus> {
    return this.post<IlinkStatus>(
      "ilink/bot/sendmessage",
      {
        msg: {
          from_user_id: "",
          to_user_id: to,
          client_id: `rove-weixin-${randomUUID()}`,
          message_type: MSG_TYPE_BOT,
          message_state: MSG_STATE_FINISH,
          item_list: [{ type: ITEM_TEXT, text_item: { text } }],
          ...(contextToken ? { context_token: contextToken } : {}),
        },
      },
      API_TIMEOUT_MS,
    )
  }
}
