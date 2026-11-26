/** Settings → Connectors: the apps Rove can be messaged from, read and changed on this machine. */

import {
  chatConnectorStatuses,
  connectChatConnector,
  disconnectChatConnector,
  updateChatConnector,
} from "@sma1lboy/rove/src/connectors/registry.ts"
import { BridgeError, optStr, str } from "../protocol.ts"
import type { OpTable } from "./types.ts"

function allowOf(args: Readonly<Record<string, unknown>>): string[] | undefined {
  const allow = args.allow
  if (allow === undefined) return undefined
  if (!Array.isArray(allow) || !allow.every((id) => typeof id === "string")) {
    throw new BridgeError("BAD_ARGS", "allow must be a list of ids")
  }
  return allow
}

export const connectorOps: OpTable = {
  "connectors.chat": {
    kind: "read",
    destructive: false,
    wraps: "chatConnectorStatuses (each shipped chat connector, connected or not)",
    run: async () => ({ connectors: await chatConnectorStatuses() }),
  },
  "connectors.chatConnect": {
    kind: "write",
    destructive: false,
    wraps: "the connector's own connect, when it needs no terminal (`rove lark connect`); else the command to run",
    run: async (args) => await connectChatConnector(str(args, "id")),
  },
  "connectors.chatDisconnect": {
    kind: "write",
    destructive: true,
    wraps: "`rove weixin logout` / `rove lark disconnect`: the binding removed on this machine",
    run: async (args) => ({ removed: await disconnectChatConnector(str(args, "id")) }),
  },
  "connectors.chatUpdate": {
    kind: "write",
    destructive: false,
    wraps: "`rove <id> allow|deny|tone`: allowed senders and the agent's tone",
    run: async (args) => {
      const allow = allowOf(args)
      const tone = optStr(args, "tone")
      await updateChatConnector(str(args, "id"), {
        ...(allow ? { allow } : {}),
        ...(tone !== undefined ? { tone } : {}),
      })
      return {}
    },
  },
}
