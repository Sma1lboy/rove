/**
 * The WeChat bridge as a Rove chat connector. Rove verbs run through a plain
 * (never-subscribed) client on the daemon's own socket — the same path a
 * `rove api` call takes, so it neither holds the daemon's lifetime nor
 * bypasses any verb's checks.
 */

import type { ChatConnector, ChatConnectorContext } from "@sma1lboy/rove-core/connectors/chat-connector.ts"
import { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import { type WeixinBridge, startWeixinBridge } from "./bridge.ts"
import { createRoveOps } from "./ops.ts"
import { WeixinStore } from "./store.ts"

export function createWeixinConnector(): ChatConnector {
  let bridge: WeixinBridge | null = null
  return {
    async start(ctx: ChatConnectorContext) {
      const client = new RoveDaemonClient(ctx.socketPath)
      try {
        await client.connect()
      } catch (err) {
        ctx.log("weixin", `could not reach the daemon socket: ${err instanceof Error ? err.message : String(err)}`)
        return
      }
      bridge = startWeixinBridge({
        store: new WeixinStore(),
        ops: createRoveOps(client),
        log: (event, message) => ctx.log(event, message),
        onUnbound: () => ctx.keepAliveChanged(),
      })
    },
    stop: () => bridge?.stop(),
    keepAlive: () => bridge?.isBound() ?? false,
  }
}
