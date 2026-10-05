/**
 * Boots the WeChat bridge inside the daemon process. Rove verbs run through a
 * plain (never-subscribed) client on the daemon's own socket — the same path
 * a `rove api` call takes, so it neither holds the daemon's lifetime nor
 * bypasses any verb's checks.
 */

import { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import { logDaemonError, logDaemonInfo } from "@sma1lboy/rove-daemon/daemon/crash-log"
import type { DaemonServer } from "@sma1lboy/rove-daemon/daemon/server"
import { type WeixinBridge, startWeixinBridge } from "./bridge.ts"
import { createRoveOps } from "./ops.ts"
import { WeixinStore } from "./store.ts"

export async function startWeixinService(server: DaemonServer): Promise<WeixinBridge | null> {
  const client = new RoveDaemonClient(server.socketPath)
  try {
    await client.connect()
  } catch (err) {
    logDaemonError("weixin", err)
    return null
  }
  return startWeixinBridge({
    store: new WeixinStore(),
    ops: createRoveOps(client),
    log: logDaemonInfo,
    onUnbound: () => server.reevaluateIdle(),
  })
}
