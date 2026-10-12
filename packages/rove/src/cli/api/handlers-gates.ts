/** Decision gates on `rove api`: raise, answer, withdraw, list — plus the answers `send` carries. */

import type { Gate } from "@sma1lboy/rove-daemon/daemon/contracts"
import type { DaemonRpc } from "../daemon-session.ts"
import { verifiedSelfSession } from "./dispatcher.ts"
import { daemonOf } from "./handler-helpers.ts"
import { ApiError, type VerbContext, helpStep } from "./types.ts"

/** `key=label`, split at the FIRST `=` so a label may contain one. */
function parseOption(raw: string): { key: string; label: string } {
  const eq = raw.indexOf("=")
  if (eq <= 0 || eq === raw.length - 1) {
    throw new ApiError(`--option must be key=label (got ${JSON.stringify(raw)})`, "BAD_FLAG", helpStep("gate-raise"))
  }
  return { key: raw.slice(0, eq).trim(), label: raw.slice(eq + 1).trim() }
}

export async function gateRaise(ctx: VerbContext): Promise<unknown> {
  const { args } = ctx
  const daemon = daemonOf(ctx)
  const taskId = args.require("task-id")
  // The tab the agent is typing in is where the answer belongs; trust the
  // env only for the task it verifiably runs in.
  let tabId = args.str("tab")
  if (!tabId) {
    const self = await verifiedSelfSession()
    if (self?.taskId === taskId) tabId = self.tabId
  }
  const res = await daemon.request<{ gate: Gate }>("gate.raise", {
    taskId,
    ...(tabId ? { tabId } : {}),
    question: args.require("question"),
    options: args.list("option").map(parseOption),
    ...(args.str("recommend") ? { recommended: args.str("recommend") } : {}),
    ...(args.str("context") ? { context: args.str("context") } : {}),
  })
  return { ok: true, gate: res.gate }
}

export async function gateAnswer(ctx: VerbContext): Promise<unknown> {
  const { args } = ctx
  const option = args.str("option")
  const text = args.str("text")
  if (option === undefined && text === undefined) {
    throw new ApiError("pass --option KEY and/or --text TEXT", "MISSING_FLAG", helpStep("gate-answer"))
  }
  const res = await daemonOf(ctx).request<{ gate: Gate; delivered: boolean }>("gate.answer", {
    gateId: args.require("gate"),
    ...(option !== undefined ? { option } : {}),
    ...(text !== undefined ? { text } : {}),
    by: "cli",
  })
  return { ok: true, gate: res.gate, delivered: res.delivered }
}

export async function gateWithdraw(ctx: VerbContext): Promise<unknown> {
  const res = await daemonOf(ctx).request<{ gate: Gate }>("gate.withdraw", { gateId: ctx.args.require("gate") })
  return { ok: true, gate: res.gate }
}

export async function gates(ctx: VerbContext): Promise<unknown> {
  const { args } = ctx
  const repo = args.str("repo") ? args.requireRepo("repo") : undefined
  const res = await daemonOf(ctx).request<{ gates: Gate[] }>("gate.list", {
    ...(repo ? { repo } : {}),
    ...(args.str("task-id") ? { taskId: args.str("task-id") } : {}),
    status: args.enumOf<string>("status") ?? "open",
  })
  return { gates: res.gates }
}

/** Answers still owed to this delivery's tab; `null` when none or the daemon predates gates. */
export async function takeOwedGateAnswers(
  daemon: DaemonRpc,
  taskId: string,
  tab: string | undefined,
): Promise<{ text: string; gateIds: string[] } | null> {
  // A fresh tab is a different conversation: the answer stays owed to its own.
  if (tab === "new") return null
  try {
    const owed = await daemon.request<{ text: string | null; gateIds: string[] }>("gate.takeUndelivered", {
      taskId,
      ...(tab ? { tabId: tab } : {}),
    })
    return owed.text ? { text: owed.text, gateIds: owed.gateIds } : null
  } catch {
    return null // never block a send on the gate ledger
  }
}

/** The prompt landed: the answers are the engine's now. Best-effort, like the read. */
export async function markGateAnswersDelivered(daemon: DaemonRpc, gateIds: readonly string[]): Promise<void> {
  await daemon.request("gate.markDelivered", { gateIds }).catch(() => {})
}
