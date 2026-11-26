/** Public entry: the Lark chat connector module Rove's connector registry loads. */

import type { ChatConnectorModule } from "@sma1lboy/rove/src/connectors/chat-connector.ts"
import { runLarkCli } from "./cli.ts"
import { createLarkConnector } from "./connector.ts"
import { LarkStore } from "./store.ts"

const lark: ChatConnectorModule = {
  id: "lark",
  createConnector: createLarkConnector,
  runCli: runLarkCli,
  status() {
    const config = new LarkStore().readConfig()
    return config ? { connected: true, ...(config.savedAt ? { since: config.savedAt } : {}) } : { connected: false }
  },
}

export default lark
