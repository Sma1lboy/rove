/**
 * Row-status RPCs (`row-status-store.ts`): the snapshot, and the two things only
 * a client can know: which tab its user is looking at, and that its user just
 * answered a question. Everything else the daemon sees itself.
 */

import { optionalString, requireString } from "./handler-validators.ts"
import type { DaemonHandlerContext, DaemonRequestHandler } from "./handlers.ts"
import type { RowStatusStore } from "./row-status-store.ts"

function storeOf(ctx: DaemonHandlerContext): RowStatusStore {
  if (!ctx.rowStatus) throw new Error("row status unavailable")
  return ctx.rowStatus
}

export const ROW_STATUS_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    name: "status.list",
    handle(_payload, ctx) {
      return storeOf(ctx).list()
    },
  },
  {
    // `taskId` null = this viewer shows no task. `viewer` names one of several screens behind one
    // connection (the bridge's browsers); a TUI omits it. Cleared when the connection closes.
    name: "ui.viewing",
    handle(payload, ctx) {
      const taskId = payload.taskId === null ? null : requireString(payload, "taskId")
      const tabId = optionalString(payload, "tabId") ?? null
      storeOf(ctx).setViewing(ctx.clientId, optionalString(payload, "viewer") ?? "", taskId, tabId)
      return { ok: true }
    },
  },
  {
    name: "activity.answered",
    handle(payload, ctx) {
      storeOf(ctx).setAnswered(requireString(payload, "taskId"), requireString(payload, "tabId"))
      return { ok: true }
    },
  },
]
