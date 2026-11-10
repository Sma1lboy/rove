/**
 * Terminal-tab RPCs (`tabs-store.ts`). Every client changes a task's tabs only
 * through `tabs.apply`; the store publishes the result on `tabs.changed`.
 */

import { optionalNumber, requireString } from "./handler-validators.ts"
import type { DaemonHandlerContext, DaemonRequestHandler } from "./handlers.ts"
import type { TabOp } from "./tabs-ops.ts"
import type { TabsStore } from "./tabs-store.ts"

const OPS = new Set(["seed", "open", "patch", "close", "order", "focus", "meta", "forget"])

function storeOf(ctx: DaemonHandlerContext): TabsStore {
  if (!ctx.tabs) throw new Error("tab store unavailable")
  return ctx.tabs
}

function opsOf(payload: Record<string, unknown>): TabOp[] {
  const ops = payload.ops
  if (!Array.isArray(ops)) throw new Error("ops must be an array")
  for (const op of ops) {
    const name = op && typeof op === "object" ? (op as { op?: unknown }).op : undefined
    if (typeof name !== "string" || !OPS.has(name)) throw new Error(`unknown tab op: ${String(name)}`)
    if (name === "open") {
      const row = (op as { row?: unknown }).row
      if (!row || typeof row !== "object" || typeof (row as { kind?: unknown }).kind !== "string") {
        throw new Error("open needs a row with a string kind")
      }
    }
    if ((name === "patch" || name === "close" || name === "focus") && typeof (op as { id?: unknown }).id !== "string") {
      throw new Error(`${name} needs a string id`)
    }
  }
  return ops as TabOp[]
}

export const TAB_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    name: "tabs.apply",
    handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const ops = opsOf(payload)
      // `forget` is the delete flow's; anything else needs a live task.
      if (!ctx.orch.getTask(taskId) && !ops.every((op) => op.op === "forget")) {
        throw new Error(`task not found: ${taskId}`)
      }
      return storeOf(ctx).apply(taskId, ops)
    },
  },
  {
    name: "tabs.get",
    handle(payload, ctx) {
      return storeOf(ctx).get(requireString(payload, "taskId"))
    },
  },
  {
    name: "tabs.list",
    handle(_payload, ctx) {
      return storeOf(ctx).list()
    },
  },
  {
    name: "tabs.reserve",
    handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      if (!ctx.orch.getTask(taskId)) throw new Error(`task not found: ${taskId}`)
      return storeOf(ctx).reserve(taskId, optionalNumber(payload, "count") ?? 2)
    },
  },
  {
    name: "tabs.release",
    handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const from = optionalNumber(payload, "from")
      const to = optionalNumber(payload, "to")
      if (from === undefined || to === undefined) throw new Error("release needs from and to")
      storeOf(ctx).release(taskId, from, to)
      return { ok: true }
    },
  },
]
