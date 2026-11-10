/**
 * The Inbox's peek-and-reply: what a waiting tab shows and the three ways an answer reaches it. A message
 * rides `tab.send` (the engine's own composer, which queues behind a busy turn itself); a menu takes keys, never a paste;
 * a decision gate takes `gate.answer`.
 */

import { type BridgeClient, BridgeRequestError } from "./bridge.ts"
import { t } from "./i18n/index.ts"
import { PEEK_LINES, type TerminalReply, tailOf } from "./inbox.ts"
import type { AppModel } from "./model.ts"
import { streamKey } from "./term-contract.ts"
import { termFor } from "./term-control.ts"
import { hasParked } from "./term-pool.ts"
import { toast } from "./ui.ts"

/** The terminal text, not the engine's transcript: a menu is on the screen and never in the history. */
export async function readTail(client: BridgeClient, taskId: string, tabId: string): Promise<string[]> {
  return tailOf(
    await client.request<TerminalReply>("output.read", { taskId, tab: tabId, source: "terminal", limit: PEEK_LINES }),
  )
}

interface SendReply {
  readonly delivered: boolean
  readonly reason?: string
}

/** Types `prompt` into the tab like the terminal composer does. True once the engine took it. */
export async function sendReply(model: AppModel, taskId: string, tabId: string, prompt: string): Promise<boolean> {
  try {
    const res = await model.client.request<SendReply>("tab.send", { taskId, tabId, prompt })
    if (!res.delivered) {
      toast(t("layout.composerNotSent", { reason: res.reason ?? "" }), "error")
      return false
    }
    return true
  } catch (err) {
    const code = err instanceof BridgeRequestError ? err.code : undefined
    toast(
      code === "UNKNOWN_OP"
        ? t("layout.composerOldBridge")
        : code === "AWAITING_PERMISSION"
          ? t("layout.composerAtMenu")
          : err instanceof Error
            ? err.message
            : String(err),
      "error",
    )
    return false
  }
}

/**
 * Keys into a tab's terminal. `term.input` only reaches a stream this page attached, so a tab no terminal view
 * holds is attached for the one write and released again; one a view holds keeps its attach.
 */
export async function pressKeys(model: AppModel, taskId: string, tabId: string, data: string): Promise<boolean> {
  const { client } = model
  const stream = streamKey(taskId, tabId)
  const borrowed = termFor(stream) !== undefined || hasParked(client, taskId, tabId)
  try {
    if (!borrowed) await client.request("term.attach", { taskId, tabId })
    await client.request("term.input", { stream, data })
    return true
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err), "error")
    return false
  } finally {
    if (!borrowed) await client.request("term.detach", { stream }).catch(() => {})
  }
}

/** Answers a decision gate with a choice (`option`) or free text. The daemon saves it, then pastes it into the engine. */
export async function answerGate(
  model: AppModel,
  gateId: string,
  answer: { readonly option: string } | { readonly text: string },
): Promise<boolean> {
  try {
    const res = await model.client.request<{ delivered: boolean }>("gate.answer", { gateId, ...answer })
    if (!res.delivered) toast(t("inbox.gateKept"))
    return true
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err), "error")
    return false
  }
}
