/** Public entry: the WeChat chat connector module Rove's connector registry loads. */

import type { ChatConnectorModule } from "@sma1lboy/rove/src/connectors/chat-connector.ts"
import { runWeixinCli } from "./cli.ts"
import { createWeixinConnector } from "./connector.ts"
import { WeixinStore } from "./store.ts"

const weixin: ChatConnectorModule = {
  id: "weixin",
  createConnector: createWeixinConnector,
  runCli: runWeixinCli,
  status() {
    const account = new WeixinStore().readAccount()
    return account ? { connected: true, ...(account.savedAt ? { since: account.savedAt } : {}) } : { connected: false }
  },
}

export default weixin
