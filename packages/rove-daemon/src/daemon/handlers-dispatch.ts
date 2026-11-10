/** Dispatch-ledger RPCs (`dispatch-ledger.ts`): the snapshot, and the one dispatch the daemon cannot see itself. */

import { DISPATCH_PROMPT_HEAD_CHARS, type DispatchEnd, type DispatchLedger } from "./dispatch-ledger.ts"
import { optionalString, requireString } from "./handler-validators.ts"
import type { DaemonHandlerContext, DaemonRequestHandler } from "./handlers.ts"

function ledgerOf(ctx: DaemonHandlerContext): DispatchLedger {
  if (!ctx.dispatches) throw new Error("dispatch ledger unavailable")
  return ctx.dispatches
}

/** The sender a CLI verb names with its verified `$ROVE_TASK_ID`/`$ROVE_TAB_ID`; null = the owner. */
export function senderOf(payload: Record<string, unknown>): DispatchEnd | null {
  const taskId = optionalString(payload, "fromTaskId")
  return taskId ? { taskId, tabId: optionalString(payload, "fromTabId") ?? null } : null
}

export const DISPATCH_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    name: "dispatch.list",
    handle(_payload, ctx) {
      return ledgerOf(ctx).list()
    },
  },
  {
    // `api send` pastes through the PTY host's own socket, past the daemon, so the CLI reports it.
    name: "dispatch.record",
    handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      if (typeof payload.delivered !== "boolean") throw new Error("delivered must be a boolean")
      const row = ledgerOf(ctx).record({
        kind: "send",
        from: senderOf(payload),
        to: { taskId, tabId: optionalString(payload, "tabId") ?? null },
        promptHead: requireString(payload, "promptHead").slice(0, DISPATCH_PROMPT_HEAD_CHARS * 4),
        delivered: payload.delivered,
        ...(optionalString(payload, "reason") ? { reason: optionalString(payload, "reason") } : {}),
        ...(optionalString(payload, "deliveryId") ? { deliveryId: optionalString(payload, "deliveryId") } : {}),
      })
      return { id: row.id }
    },
  },
]
