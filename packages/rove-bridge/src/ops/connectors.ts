/** Settings → Connectors: the apps Rove can be messaged from, read on this machine. */

import { chatConnectorStatuses } from "@sma1lboy/rove/src/connectors/registry.ts"
import type { OpTable } from "./types.ts"

export const connectorOps: OpTable = {
  "connectors.chat": {
    kind: "read",
    destructive: false,
    wraps: "chatConnectorStatuses (each shipped chat connector, connected or not)",
    run: async () => ({ connectors: await chatConnectorStatuses() }),
  },
}
