/**
 * Decision-gate op: the phone's answer to a question a task put to its owner. One RPC
 * (`gate.answer`), always attributed to the bridge; the daemon persists the answer, then
 * hands it to the engine tab (or leaves it owed when no engine is live).
 */

import { BridgeError } from "../protocol.ts"
import { optText } from "./args.ts"
import type { Args, OpContext, OpSpec, OpTable } from "./types.ts"

const GATE_ID = /^g-\d{1,9}$/
const OPTION_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/
/** The daemon's own cap on an answer note (`gates-store.ts`). */
const TEXT_MAX = 4000
/** The daemon's refusals lead with a stable code; keep it on the wire for the phone to branch on. */
const DAEMON_CODE = /^(GATE_NOT_FOUND|GATE_NOT_OPEN|BAD_OPTION): /

function gateId(args: Args): string {
  const v = args.gateId
  if (typeof v !== "string" || !GATE_ID.test(v)) throw new BridgeError("BAD_ARGS", "gateId is not a gate id")
  return v
}

async function answer(args: Args, ctx: OpContext): Promise<unknown> {
  const id = gateId(args)
  const option = args.option
  if (option !== undefined && option !== null && (typeof option !== "string" || !OPTION_KEY.test(option)))
    throw new BridgeError("BAD_ARGS", "option is not an option key")
  const text = optText(args, "text", TEXT_MAX)
  if (!option && !text) throw new BridgeError("BAD_ARGS", "answer needs an option or text")
  try {
    const res = await ctx.api.rpc<{ delivered?: boolean }>("gate.answer", {
      gateId: id,
      ...(option ? { option } : {}),
      ...(text ? { text } : {}),
      by: "bridge",
    })
    return { delivered: res.delivered === true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const code = DAEMON_CODE.exec(message)?.[1]
    if (code) throw new BridgeError(code, message.replace(DAEMON_CODE, ""))
    throw err
  }
}

const gateAnswer: OpSpec = { kind: "write", destructive: false, wraps: "rpc gate.answer (by: bridge)", run: answer }

export const GATE_OPS: OpTable = { "gate.answer": gateAnswer }
