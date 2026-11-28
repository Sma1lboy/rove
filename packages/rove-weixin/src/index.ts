/** Public entry: the WeChat chat connector module Rove's connector registry loads. */

import type { ChatConnectorModule } from "@sma1lboy/rove-core/connectors/chat-connector.ts"
import { runWeixinCli } from "./cli.ts"
import { createWeixinConnector } from "./connector.ts"
import { WeixinStore } from "./store.ts"

const weixin: ChatConnectorModule = {
  id: "weixin",
  createConnector: createWeixinConnector,
  runCli: runWeixinCli,
  status() {
    const store = new WeixinStore()
    const account = store.readAccount()
    if (!account) return { connected: false }
    const agentTaskId = account.agent?.taskId ?? store.readState(account.accountId).agent?.taskId
    return {
      connected: true,
      ...(account.savedAt ? { since: account.savedAt } : {}),
      ...(agentTaskId ? { agentTaskId } : {}),
      allow: account.allow,
    }
  },
  // Credentials go; a new binding needs the QR code in a terminal again.
  disconnect: () => new WeixinStore().clearAccount(),
  update(settings) {
    const store = new WeixinStore()
    const account = store.readAccount()
    if (!account) throw new Error("WeChat is not connected")
    if (settings.allow) store.writeAccount({ ...account, allow: [...new Set(settings.allow)] })
  },
}

export default weixin
