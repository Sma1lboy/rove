/** Public entry: the Lark chat connector module Rove's connector registry loads. */

import type { ChatConnectorModule } from "@sma1lboy/rove-core/connectors/chat-connector.ts"
import { runLarkCli } from "./cli.ts"
import { connectLark } from "./connect.ts"
import { createLarkConnector } from "./connector.ts"
import { DEFAULT_TONE, LarkStore } from "./store.ts"

const lark: ChatConnectorModule = {
  id: "lark",
  createConnector: createLarkConnector,
  runCli: runLarkCli,
  status() {
    const store = new LarkStore()
    const config = store.readConfig()
    if (!config) return { connected: false }
    const agentTaskId = store.readState().agent?.taskId
    return {
      connected: true,
      ...(config.savedAt ? { since: config.savedAt } : {}),
      ...(config.botName ? { account: config.botName } : {}),
      ...(config.ownerName || config.ownerOpenId ? { owner: config.ownerName || config.ownerOpenId } : {}),
      ...(agentTaskId ? { agentTaskId } : {}),
      allow: config.allow,
      tone: config.tone,
    }
  },
  disconnect: () => new LarkStore().clearConfig(),
  connect: async () => {
    const out = await connectLark(new LarkStore(), { interactive: false })
    return out.ok ? { ok: true } : { ok: false, message: out.message }
  },
  update(settings) {
    const store = new LarkStore()
    const config = store.readConfig()
    if (!config) throw new Error("Lark is not connected")
    store.writeConfig({
      ...config,
      ...(settings.allow ? { allow: [...new Set(settings.allow.map((id) => id.trim()).filter(Boolean))] } : {}),
      ...(settings.tone !== undefined ? { tone: settings.tone.trim() || DEFAULT_TONE } : {}),
    })
  },
}

export default lark
