/** Decision-gate RPCs: raise, answer (persist, then hand to the engine), withdraw, list. */

import { logDaemonError } from "./crash-log.ts"
import type { Gate, GateAnswerSurface, GateOption, GateStatus } from "./gate-contracts.ts"
import { type GateAnswerDelivery, armGateAnswerDelivery, countGateRaiseAsReport } from "./gate-deliveries.ts"
import { takeUndeliveredGateAnswers } from "./gate-handoff.ts"
import { optionalString, requireString } from "./handler-validators.ts"
import type { DaemonHandlerContext, DaemonRequestHandler } from "./handlers.ts"

const SURFACES: readonly GateAnswerSurface[] = ["tui", "bridge", "weixin", "cli"]
const STATUS_FILTERS: readonly (GateStatus | "all")[] = ["open", "answered", "withdrawn", "all"]

function parseOptions(raw: unknown): GateOption[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new Error("options must be an array")
  return raw.map((entry) => {
    const o = entry as Partial<GateOption> | null
    if (!o || typeof o.key !== "string" || typeof o.label !== "string")
      throw new Error("each option needs a string key and label")
    return { key: o.key, label: o.label, ...(typeof o.detail === "string" && o.detail ? { detail: o.detail } : {}) }
  })
}

/** Tail of each task's delivery chain: two answers for one tab must not take the same owed answer. */
const deliveryChains = new Map<string, Promise<unknown>>()

function deliverGateAnswer(ctx: DaemonHandlerContext, gate: Gate): Promise<boolean> {
  const tail = deliveryChains.get(gate.taskId) ?? Promise.resolve()
  const run = tail.then(() => pasteGateAnswer(ctx, gate))
  const next = run.catch(() => {})
  deliveryChains.set(gate.taskId, next)
  void next.then(() => {
    if (deliveryChains.get(gate.taskId) === next) deliveryChains.delete(gate.taskId)
  })
  return run
}

/**
 * Hand an answered gate (and any older answers still owed to the same tab) to
 * the live engine. Never spawns, queues or retries: no live engine leaves the
 * handoff `undelivered`, and the next prompt to that tab carries it.
 */
async function pasteGateAnswer(ctx: DaemonHandlerContext, gate: Gate): Promise<boolean> {
  const task = ctx.orch.getTask(gate.taskId)
  if (!task || task.deletion || !task.worktreePath) return false
  const handoff = takeUndeliveredGateAnswers(ctx.gates, gate.taskId, gate.tabId)
  if (!handoff) return false
  const target = { id: task.id, vendor: task.vendor, command: task.command, worktreePath: task.worktreePath }
  // Arms a delivery when the task requires reports; its footer rides the paste.
  let armed: GateAnswerDelivery | null = null
  try {
    armed = await armGateAnswerDelivery(ctx, task, gate)
    const text = armed ? `${handoff.text}\n\n${armed.footer}` : handoff.text
    const result = gate.tabId
      ? await ctx.runtime.deliverPromptToLiveEngineTabDetailed({ ...target, tabId: gate.tabId }, text)
      : await ctx.runtime.deliverPromptToLiveEngineDetailed(target, text)
    if (result.outcome !== "delivered") {
      // Nothing landed: no turn will come, so the expectation must not linger.
      if (armed) await ctx.deliveries.cancel(armed.deliveryId)
      return false
    }
    if (armed) await ctx.deliveries.setTab(armed.deliveryId, result.tabId)
    await ctx.gates.markDelivered(handoff.gateIds)
    return true
  } catch (err) {
    logDaemonError("gate-answer-delivery", err)
    if (armed) await ctx.deliveries.cancel(armed.deliveryId).catch(() => {})
    return false
  }
}

export const GATE_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    name: "gate.raise",
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const task = ctx.orch.getTask(taskId)
      if (!task || task.deletion) throw new Error(`task not found: ${taskId}`)
      const recommended = optionalString(payload, "recommended")
      const context = optionalString(payload, "context")
      const gate = await ctx.gates.raise({
        taskId,
        tabId: optionalString(payload, "tabId") ?? null,
        question: requireString(payload, "question"),
        options: parseOptions(payload.options),
        ...(recommended ? { recommended } : {}),
        ...(context ? { context } : {}),
      })
      const reported = await countGateRaiseAsReport(ctx, gate)
      return { gate: reported ? await ctx.gates.attachDelivery(gate.id, reported.id) : gate }
    },
  },
  {
    name: "gate.answer",
    async handle(payload, ctx) {
      const by = optionalString(payload, "by") ?? "cli"
      if (!SURFACES.includes(by as GateAnswerSurface)) throw new Error(`by must be one of ${SURFACES.join(", ")}`)
      const gateId = requireString(payload, "gateId")
      const option = optionalString(payload, "option")
      const text = optionalString(payload, "text")
      const gate = await ctx.gates.answer(gateId, {
        ...(option !== undefined ? { option } : {}),
        ...(text !== undefined ? { text } : {}),
        by: by as GateAnswerSurface,
      })
      const delivered = await deliverGateAnswer(ctx, gate)
      return { gate: ctx.gates.get(gateId) ?? gate, delivered }
    },
  },
  {
    name: "gate.withdraw",
    async handle(payload, ctx) {
      return { gate: await ctx.gates.withdraw(requireString(payload, "gateId")) }
    },
  },
  {
    name: "gate.list",
    handle(payload, ctx) {
      const status = optionalString(payload, "status") ?? "open"
      if (!STATUS_FILTERS.includes(status as GateStatus | "all"))
        throw new Error(`status must be one of ${STATUS_FILTERS.join(", ")}`)
      const taskId = optionalString(payload, "taskId")
      const repo = optionalString(payload, "repo")
      const gates = ctx.gates
        .list({ status: status as GateStatus | "all", ...(taskId ? { taskId } : {}) })
        .filter((g) => repo === undefined || ctx.orch.getTask(g.taskId)?.repo === repo)
      return { gates }
    },
  },
  {
    // Read-only: `send` marks only after its paste landed, so a failed one loses nothing.
    name: "gate.takeUndelivered",
    handle(payload, ctx) {
      const handoff = takeUndeliveredGateAnswers(
        ctx.gates,
        requireString(payload, "taskId"),
        optionalString(payload, "tabId"),
      )
      return handoff ?? { text: null, gateIds: [] }
    },
  },
  {
    name: "gate.markDelivered",
    async handle(payload, ctx) {
      const ids = payload.gateIds
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) throw new Error("gateIds must be strings")
      await ctx.gates.markDelivered(ids as string[])
      return {}
    },
  },
]
