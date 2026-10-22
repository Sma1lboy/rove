/**
 * One outbound message as WeChat bubbles. Shared by the daemon's bridge and
 * `rove weixin send`, so both obey the same retry rules: a stale context token
 * gets one tokenless retry (iLink's degraded path), a rate limit one delayed
 * retry, anything else stops and hands back what was not sent.
 */

import { toBubbles } from "./format.ts"
import { type IlinkClient, type IlinkStatus, classifyIlink, describeIlink } from "./ilink.ts"

const RETRY_MS = 2_000
const BUBBLE_GAP_MS = 300

export type SendResult =
  | { readonly ok: true }
  // `rest`: the bubbles that never went out.
  | { readonly ok: false; readonly reason: string; readonly rest: string }

export async function sendBubbles(
  client: Pick<IlinkClient, "sendText">,
  to: string,
  text: string,
  contextToken: string | null,
  sleep: (ms: number) => Promise<unknown>,
): Promise<SendResult> {
  const bubbles = toBubbles(text)
  for (let i = 0; i < bubbles.length; i++) {
    const bubble = bubbles[i] ?? ""
    let token = contextToken
    let retried = false
    for (;;) {
      let resp: IlinkStatus
      try {
        resp = await client.sendText(to, bubble, token)
      } catch (err) {
        return {
          ok: false,
          reason: `network: ${err instanceof Error ? err.message : String(err)}`,
          rest: bubbles.slice(i).join("\n"),
        }
      }
      const outcome = classifyIlink(resp)
      if (outcome === "ok") break
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
      return { ok: false, reason: `iLink refused: ${describeIlink(resp)}${hint}`, rest: bubbles.slice(i).join("\n") }
    }
    if (i < bubbles.length - 1) await sleep(BUBBLE_GAP_MS)
  }
  return { ok: true }
}
