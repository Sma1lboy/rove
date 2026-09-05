/** Per-turn telemetry read RPC. Read-only; the write side is the
 *  hook-driven ingest in `agent-turns-ingest.ts`. */

import { optionalNumber, optionalString } from "./handler-validators.ts"
import type { DaemonRequestHandler } from "./handlers.ts"

export const AGENT_TURN_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    name: "agentTurn.list",
    handle(payload, ctx) {
      const taskId = optionalString(payload, "taskId")
      const repo = optionalString(payload, "repoRoot")
      const since = optionalNumber(payload, "since")
      const limit = optionalNumber(payload, "limit")
      return {
        turns:
          ctx.agentTurns?.list({
            ...(taskId ? { taskId } : {}),
            ...(repo ? { repo } : {}),
            ...(since !== undefined ? { since } : {}),
            ...(limit !== undefined ? { limit } : {}),
          }) ?? [],
      }
    },
  },
]
