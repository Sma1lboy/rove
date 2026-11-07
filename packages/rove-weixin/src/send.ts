/**
 * Outbound messages: text as WeChat bubbles, files as uploaded attachments.
 * Shared by the daemon's bridge and `rove weixin send`, so both obey the same
 * retry rules: a stale context token gets one tokenless retry (iLink's
 * degraded path), a rate limit one delayed retry, anything else stops and
 * hands back what was not sent.
 */

import { toBubbles } from "./format.ts"
import { type IlinkClient, type IlinkStatus, classifyIlink, describeIlink } from "./ilink.ts"
import { uploadAttachment } from "./media.ts"

const RETRY_MS = 2_000
const BUBBLE_GAP_MS = 300

export type SendResult =
  | { readonly ok: true }
  // `rest`: the bubbles that never went out.
  | { readonly ok: false; readonly reason: string; readonly rest: string }

type Sleep = (ms: number) => Promise<unknown>

/** One message under the retry rules; the failure reason, or null once sent. */
async function sendOnce(
  send: (token: string | null) => Promise<IlinkStatus>,
  contextToken: string | null,
  sleep: Sleep,
): Promise<string | null> {
  let token = contextToken
  let retried = false
  for (;;) {
    let resp: IlinkStatus
    try {
      resp = await send(token)
    } catch (err) {
      return `network: ${err instanceof Error ? err.message : String(err)}`
    }
    const outcome = classifyIlink(resp)
    if (outcome === "ok") return null
    if (!retried && outcome === "session-expired" && token) {
      retried = true
      token = null
      continue
    }
    if (!retried && outcome === "rate-limited") {
      retried = true
      await sleep(RETRY_MS)
      continue
    }
    const hint = outcome === "session-expired" ? " — they need to message the bot first" : ""
    return `iLink refused: ${describeIlink(resp)}${hint}`
  }
}

export async function sendBubbles(
  client: Pick<IlinkClient, "sendText">,
  to: string,
  text: string,
  contextToken: string | null,
  sleep: Sleep,
): Promise<SendResult> {
  const bubbles = toBubbles(text)
  for (let i = 0; i < bubbles.length; i++) {
    const bubble = bubbles[i] ?? ""
    const reason = await sendOnce((token) => client.sendText(to, bubble, token), contextToken, sleep)
    if (reason) return { ok: false, reason, rest: bubbles.slice(i).join("\n") }
    if (i < bubbles.length - 1) await sleep(BUBBLE_GAP_MS)
  }
  return { ok: true }
}

/** The file at `path` as its own message: a picture, a video, or a file attachment. Null once sent. */
export async function sendAttachment(
  client: Pick<IlinkClient, "sendItem" | "uploadUrl" | "fetchFn">,
  to: string,
  path: string,
  contextToken: string | null,
  sleep: Sleep,
): Promise<string | null> {
  let item: Record<string, unknown>
  try {
    item = await uploadAttachment(client, to, path)
  } catch (err) {
    return `upload: ${err instanceof Error ? err.message : String(err)}`
  }
  return sendOnce((token) => client.sendItem(to, item, token), contextToken, sleep)
}
